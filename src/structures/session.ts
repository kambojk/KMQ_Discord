import * as uuid from "uuid";
import { IPCLogger } from "../logger";
import { KmqImages, specialFfmpegArgs } from "../constants";
import {
    areUsersPremium,
    ensureVoiceConnection,
    getLocalizedArtistName,
    getLocalizedSongName,
} from "../helpers/game_utils";
import {
    bold,
    friendlyFormattedNumber,
    getMention,
    underline,
} from "../helpers/utils";
import {
    getCurrentVoiceMembers,
    getDebugLogHeader,
    sendBookmarkedSongs,
    sendErrorMessage,
    sendInfoMessage,
    tryCreateInteractionErrorAcknowledgement,
    tryCreateInteractionSuccessAcknowledgement,
    tryInteractionAcknowledge,
} from "../helpers/discord_utils";
import { getFact } from "../fact_generator";
import Eris from "eris";
import GameRound from "./game_round";
import GuessModeType from "../enums/option_types/guess_mode_type";
import GuildPreference from "./guild_preference";
import ListeningRound from "./listening_round";
import LocaleType from "../enums/locale_type";
import LocalizationManager from "../helpers/localization_manager";
import MessageContext from "./message_context";
import SeekType from "../enums/option_types/seek_type";
import SongSelector from "./song_selector";
import State from "../state";
import dbContext from "../database_context";
import fs from "fs";
import type BookmarkedSong from "../interfaces/bookmarked_song";
import type EmbedPayload from "../interfaces/embed_payload";
import type GameSession from "./game_session";
import type GuessResult from "../interfaces/guess_result";
import type KmqMember from "./kmq_member";
import type ListeningSession from "./listening_session";
import type QueriedSong from "../interfaces/queried_song";
import type Round from "./round";

const BOOKMARK_MESSAGE_SIZE = 10;

const logger = new IPCLogger("session");

export default abstract class Session {
    /** The ID of text channel in which the GameSession was started in, and will be active in */
    public readonly textChannelID: string;

    /** The Discord Guild ID */
    public readonly guildID: string;

    /** The time the GameSession was started in epoch milliseconds */
    public readonly startedAt: number;

    /** The ID of the voice channel in which the GameSession was started in, and will be active in */
    public voiceChannelID: string;

    /** Initially the user who started the GameSession, transferred to current VC member */
    public owner: KmqMember;

    /** The current active Eris.VoiceConnection */
    public connection: Eris.VoiceConnection;

    /** The last time of activity in epoch milliseconds, used to track inactive sessions  */
    public lastActive: number;

    /** The current Round */
    public round: Round;

    /** Whether the GameSession has ended or not */
    public finished: boolean;

    /** Whether the GameSession is active yet */
    public sessionInitialized: boolean;

    public songSelector: SongSelector;

    /** Whether the session has premium members */
    public isPremium: boolean;

    /** The guild preference */
    protected guildPreference: GuildPreference;

    /** The number of Rounds played */
    protected roundsPlayed: number;

    /** Array of previous songs by messageID for bookmarking songs */
    private songMessageIDs: { messageID: string; song: QueriedSong }[];

    /** Mapping of user ID to bookmarked songs, uses Map since Set doesn't remove QueriedSong duplicates */
    private bookmarkedSongs: {
        [userID: string]: Map<string, BookmarkedSong>;
    };

    /** Timer function used to for ,timer command */
    private guessTimeoutFunc: NodeJS.Timer;

    constructor(
        guildPreference: GuildPreference,
        textChannelID: string,
        voiceChannelID: string,
        guildID: string,
        gameSessionCreator: KmqMember,
        isPremium: boolean
    ) {
        this.guildPreference = guildPreference;
        this.textChannelID = textChannelID;
        this.voiceChannelID = voiceChannelID;
        this.guildID = guildID;
        this.owner = gameSessionCreator;
        this.lastActive = Date.now();
        this.startedAt = Date.now();
        this.finished = false;
        this.roundsPlayed = 0;
        this.songMessageIDs = [];
        this.bookmarkedSongs = {};
        this.songSelector = new SongSelector();
        this.isPremium = isPremium;

        this.guildPreference.reloadSongCallback = async () => {
            logger.info(
                `gid: ${this.guildID} | Game options modified, songs reloaded`
            );

            await this.songSelector.reloadSongs(
                this.guildPreference,
                this.isPremium
            );
        };
    }

    abstract sessionName(): string;

    static getSession(guildID: string): Session {
        return State.gameSessions[guildID] ?? State.listeningSessions[guildID];
    }

    /**
     * Deletes the GameSession corresponding to a given guild ID
     * @param guildID - The guild ID
     */
    static deleteSession(guildID: string): void {
        const isGameSession = guildID in State.gameSessions;
        const isListeningSession = guildID in State.listeningSessions;
        if (!isGameSession && !isListeningSession) {
            logger.debug(`gid: ${guildID} | Session already ended`);
            return;
        }

        if (isGameSession) {
            delete State.gameSessions[guildID];
        } else if (isListeningSession) {
            delete State.listeningSessions[guildID];
        }
    }

    // eslint-disable-next-line class-methods-use-this
    isListeningSession(): this is ListeningSession {
        return false;
    }

    // eslint-disable-next-line class-methods-use-this
    isGameSession(): this is GameSession {
        return false;
    }

    /**
     * Starting a new Round
     * @param messageContext - An object containing relevant parts of Eris.Message
     */
    async startRound(messageContext: MessageContext): Promise<boolean> {
        if (!this.sessionInitialized) {
            logger.info(
                `${getDebugLogHeader(
                    messageContext
                )} | ${this.sessionName()} starting`
            );
        }

        this.sessionInitialized = true;
        if (this.songSelector.getSongs() === null) {
            try {
                await this.songSelector.reloadSongs(
                    this.guildPreference,
                    this.isPremium
                );
            } catch (err) {
                await sendErrorMessage(messageContext, {
                    title: LocalizationManager.localizer.translate(
                        this.guildID,
                        "misc.failure.errorSelectingSong.title"
                    ),
                    description: LocalizationManager.localizer.translate(
                        this.guildID,
                        "misc.failure.errorSelectingSong.description"
                    ),
                });

                logger.error(
                    `${getDebugLogHeader(
                        messageContext
                    )} | Error querying song: ${err.toString()}. guildPreference = ${JSON.stringify(
                        this.guildPreference
                    )}`
                );
                await this.endSession();
                return false;
            }
        }

        if (this.songSelector.checkUniqueSongQueue()) {
            const totalSongCount = this.songSelector.getCurrentSongCount();
            logger.info(
                `${getDebugLogHeader(
                    messageContext
                )} | Resetting uniqueSongsPlayed (all ${totalSongCount} unique songs played)`
            );

            await sendInfoMessage(messageContext, {
                title: LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.uniqueSongsReset.title"
                ),
                description: LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.uniqueSongsReset.description",
                    { totalSongCount: friendlyFormattedNumber(totalSongCount) }
                ),
                thumbnailUrl: KmqImages.LISTENING,
            });
        }

        this.songSelector.checkAlternatingGender(this.guildPreference);
        const randomSong = this.songSelector.queryRandomSong(
            this.guildPreference
        );

        if (randomSong === null) {
            sendErrorMessage(messageContext, {
                title: LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.failure.songQuery.title"
                ),
                description: LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.failure.songQuery.description"
                ),
            });
            await this.endSession();
            return false;
        }

        // create a new round with randomly chosen song
        this.round = this.prepareRound(randomSong);

        const voiceChannel = State.client.getChannel(
            this.voiceChannelID
        ) as Eris.VoiceChannel;

        if (!voiceChannel || voiceChannel.voiceMembers.size === 0) {
            await this.endSession();
            return false;
        }

        // join voice channel and start round
        try {
            await ensureVoiceConnection(this);
        } catch (err) {
            await this.endSession();
            logger.error(
                `${getDebugLogHeader(
                    messageContext
                )} | Error obtaining voice connection. err = ${err.toString()}`
            );

            await sendErrorMessage(messageContext, {
                title: LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.failure.vcJoin.title"
                ),
                description: LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.failure.vcJoin.description"
                ),
            });
            return false;
        }

        this.playSong(messageContext);
        return true;
    }

    /**
     * Ends an active Round
     * @param _messageContext - unused
     * @param _guessResult - unused
     */
    endRound(
        _messageContext?: MessageContext,
        _guessResult?: GuessResult
    ): Promise<void> {
        if (this.round === null) {
            return;
        }

        const round = this.round;
        this.round = null;

        if (Object.keys(this.songMessageIDs).length === BOOKMARK_MESSAGE_SIZE) {
            this.songMessageIDs.shift();
        }

        if (round.roundMessageID) {
            this.songMessageIDs.push({
                messageID: round.roundMessageID,
                song: round.song,
            });
        }

        // cleanup
        this.stopGuessTimeout();

        if (this.finished) return;
        this.roundsPlayed++;
        // check if duration has been reached
        const remainingDuration = this.getRemainingDuration(
            this.guildPreference
        );

        if (remainingDuration && remainingDuration < 0) {
            logger.info(`gid: ${this.guildID} | Game session duration reached`);
            this.endSession();
        }
    }

    /**
     * Ends the current GameSession
     */
    async endSession(): Promise<void> {
        this.guildPreference.reloadSongCallback = null;
        Session.deleteSession(this.guildID);
        await this.endRound(
            new MessageContext(this.textChannelID, null, this.guildID),
            { correct: false }
        );

        const voiceConnection = State.client.voiceConnections.get(this.guildID);

        // leave voice channel
        if (voiceConnection && voiceConnection.channelID) {
            voiceConnection.stopPlaying();
            const voiceChannel = State.client.getChannel(
                voiceConnection.channelID
            ) as Eris.VoiceChannel;

            if (voiceChannel) {
                voiceChannel.leave();
            }
        }

        // DM bookmarked songs
        const bookmarkedSongsPlayerCount = Object.keys(
            this.bookmarkedSongs
        ).length;

        if (bookmarkedSongsPlayerCount > 0) {
            const bookmarkedSongCount = Object.values(
                this.bookmarkedSongs
            ).reduce((total, x) => total + x.size, 0);

            await sendInfoMessage(new MessageContext(this.textChannelID), {
                title: LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.sendingBookmarkedSongs.title"
                ),
                description: LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.sendingBookmarkedSongs.description",
                    {
                        songs: LocalizationManager.localizer.translateN(
                            this.guildID,
                            "misc.plural.song",
                            bookmarkedSongCount
                        ),
                        players: LocalizationManager.localizer.translateN(
                            this.guildID,
                            "misc.plural.player",
                            bookmarkedSongsPlayerCount
                        ),
                    }
                ),
                thumbnailUrl: KmqImages.READING_BOOK,
            });
            await sendBookmarkedSongs(this.guildID, this.bookmarkedSongs);

            // Store bookmarked songs
            await dbContext.kmq.transaction(async (trx) => {
                const idLinkPairs: {
                    user_id: string;
                    vlink: string;
                    bookmarked_at: Date;
                }[] = [];

                for (const entry of Object.entries(this.bookmarkedSongs)) {
                    for (const song of entry[1]) {
                        idLinkPairs.push({
                            user_id: entry[0],
                            vlink: song[0],
                            bookmarked_at: song[1].bookmarkedAt,
                        });
                    }
                }

                await dbContext
                    .kmq("bookmarked_songs")
                    .insert(idLinkPairs)
                    .transacting(trx);
            });
        }

        // commit guild stats
        await dbContext
            .kmq("guilds")
            .where("guild_id", this.guildID)
            .increment("games_played", 1);
    }

    /**
     * Sets a timeout for guessing in timer mode
     * @param messageContext - An object containing relevant parts of Eris.Message
     * @param guildPreference - The GuildPreference
     */
    startGuessTimeout(messageContext: MessageContext): Promise<void> {
        if (
            this.isListeningSession() ||
            !this.guildPreference.isGuessTimeoutSet()
        )
            return;

        const time = this.guildPreference.gameOptions.guessTimeout;
        this.guessTimeoutFunc = setTimeout(async () => {
            if (this.finished || !this.round || this.round.finished) return;
            logger.info(
                `${getDebugLogHeader(
                    messageContext
                )} | Song finished without being guessed, timer of: ${time} seconds.`
            );

            await this.endRound(
                new MessageContext(this.textChannelID, null, this.guildID),
                { correct: false }
            );

            this.startRound(messageContext);
        }, time * 1000);
    }

    /**
     * Stops the timer set in timer mode
     */
    stopGuessTimeout(): void {
        clearTimeout(this.guessTimeoutFunc);
    }

    /**
     * Updates the GameSession's lastActive timestamp and it's value in the data store
     */
    async lastActiveNow(): Promise<void> {
        this.lastActive = Date.now();
        await dbContext
            .kmq("guilds")
            .where({ guild_id: this.guildID })
            .update({ last_active: new Date() });
    }

    /**
     * Finds the song associated with the endRoundMessage via messageID, if it exists
     * @param messageID - The Discord message ID used to locate the song
     * @returns the queried song, or null if it doesn't exist
     */
    getSongFromMessageID(messageID: string): QueriedSong {
        if (!this.songMessageIDs.map((x) => x.messageID).includes(messageID)) {
            return null;
        }

        return this.songMessageIDs.find((x) => x.messageID === messageID).song;
    }

    /**
     * Stores a song with a user so they can receive it later
     * @param userID - The user that wants to bookmark the song
     * @param bookmarkedSong - The song to store
     */
    addBookmarkedSong(userID: string, bookmarkedSong: BookmarkedSong): void {
        if (!userID || !bookmarkedSong) {
            return;
        }

        if (!this.bookmarkedSongs[userID]) {
            this.bookmarkedSongs[userID] = new Map();
        }

        this.bookmarkedSongs[userID].set(
            bookmarkedSong.song.youtubeLink,
            bookmarkedSong
        );

        logger.info(
            `User ${userID} bookmarked song ${bookmarkedSong.song.youtubeLink}`
        );
    }

    /** Sends a message notifying who the new owner is */
    updateOwner(): void {
        sendInfoMessage(new MessageContext(this.textChannelID), {
            title: LocalizationManager.localizer.translate(
                this.guildID,
                "misc.gameOwnerChanged.title"
            ),
            description: LocalizationManager.localizer.translate(
                this.guildID,
                "misc.gameOwnerChanged.description",
                {
                    newGameOwner: getMention(this.owner.id),
                    forcehintCommand: `\`${process.env.BOT_PREFIX}forcehint\``,
                    forceskipCommand: `\`${process.env.BOT_PREFIX}forceskip\``,
                }
            ),
            thumbnailUrl: KmqImages.LISTENING,
        });
    }

    getRemainingDuration(guildPreference: GuildPreference): number {
        const currGameLength = (Date.now() - this.startedAt) / 60000;
        return guildPreference.isDurationSet()
            ? guildPreference.gameOptions.duration - currGameLength
            : null;
    }

    handleBookmarkInteraction(
        interaction: Eris.CommandInteraction | Eris.ComponentInteraction
    ): Promise<void> {
        let song: QueriedSong;
        if (interaction instanceof Eris.CommandInteraction) {
            song = this.getSongFromMessageID(interaction.data.target_id);
        } else if (interaction instanceof Eris.ComponentInteraction) {
            song = this.getSongFromMessageID(interaction.message.id);
        }

        if (!song) {
            tryCreateInteractionErrorAcknowledgement(
                interaction,
                LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.failure.interaction.invalidBookmark",
                    { BOOKMARK_MESSAGE_SIZE: String(BOOKMARK_MESSAGE_SIZE) }
                )
            );
            return;
        }

        tryCreateInteractionSuccessAcknowledgement(
            interaction,
            LocalizationManager.localizer.translate(
                this.guildID,
                "misc.interaction.bookmarked.title"
            ),
            LocalizationManager.localizer.translate(
                this.guildID,
                "misc.interaction.bookmarked.description",
                {
                    songName: bold(
                        getLocalizedSongName(
                            song,
                            State.getGuildLocale(this.guildID)
                        )
                    ),
                }
            )
        );

        this.addBookmarkedSong(interaction.member?.id, {
            song,
            bookmarkedAt: new Date(),
        });
    }

    getRoundsPlayed(): number {
        return this.roundsPlayed;
    }

    /**
     * The game has changed its premium state, so update filtered songs and reset premium options if non-premium
     */
    async updatePremiumStatus(): Promise<void> {
        const oldPremiumStatus = this.isPremium;

        const isPremium = await areUsersPremium(
            getCurrentVoiceMembers(this.voiceChannelID).map((x) => x.id)
        );

        if (oldPremiumStatus === isPremium) {
            return;
        }

        this.isPremium = isPremium;

        const guildPreference = await GuildPreference.getGuildPreference(
            this.guildID
        );

        await this.songSelector.reloadSongs(guildPreference, isPremium);

        if (!isPremium) {
            await Promise.allSettled(
                Object.entries(State.client.commands).map(
                    async ([commandName, command]) => {
                        if (command.aliases.includes(commandName)) {
                            // Ignore duplicate calls from aliases
                            return;
                        }

                        if (command.resetPremium) {
                            logger.info(
                                `gid: ${this.guildID} | Resetting premium for game option: ${commandName}`
                            );
                            await command.resetPremium(guildPreference);
                        }
                    }
                )
            );
        }
    }

    abstract handleComponentInteraction(
        _interaction: Eris.ComponentInteraction,
        _messageContext: MessageContext
    ): Promise<void>;

    /**
     * Prepares a new Round
     * @param randomSong - The queried song
     * @returns the new Round
     */
    protected abstract prepareRound(randomSong: QueriedSong): Round;

    /**
     * Begin playing the Round's song in the VoiceChannel, listen on VoiceConnection events
     * @param messageContext - An object containing relevant parts of Eris.Message
     */
    protected async playSong(messageContext: MessageContext): Promise<void> {
        const { round } = this;
        if (round === null) {
            return;
        }

        const songLocation = `${process.env.SONG_DOWNLOAD_DIR}/${round.song.youtubeLink}.ogg`;

        let seekLocation: number;
        const seekType = this.isListeningSession()
            ? SeekType.BEGINNING
            : this.guildPreference.gameOptions.seekType;

        if (seekType === SeekType.BEGINNING) {
            seekLocation = 0;
        } else {
            const songDuration = (
                await dbContext
                    .kmq("cached_song_duration")
                    .select(["duration"])
                    .where("vlink", "=", round.song.youtubeLink)
                    .first()
            ).duration;

            if (seekType === SeekType.RANDOM) {
                seekLocation = songDuration * (0.6 * Math.random());
            } else if (seekType === SeekType.MIDDLE) {
                seekLocation = songDuration * (0.4 + 0.2 * Math.random());
            }
        }

        const stream = fs.createReadStream(songLocation);

        logger.info(
            `${getDebugLogHeader(
                messageContext
            )} | Playing song in voice connection. seek = ${seekType}. song = ${this.getDebugSongDetails()}. guess mode = ${
                this.guildPreference.gameOptions.guessModeType
            }`
        );
        this.connection.removeAllListeners();
        this.connection.stopPlaying();

        try {
            let inputArgs = ["-ss", seekLocation.toString()];
            let encoderArgs = [];
            const specialType = this.isListeningSession()
                ? null
                : this.guildPreference.gameOptions.specialType;

            if (specialType) {
                const ffmpegArgs = specialFfmpegArgs[specialType](seekLocation);
                inputArgs = ffmpegArgs.inputArgs;
                encoderArgs = ffmpegArgs.encoderArgs;
            }

            this.connection.play(stream, {
                inputArgs,
                encoderArgs,
                opusPassthrough: specialType === null,
            });
        } catch (e) {
            logger.error(`Erroring playing on voice connection. err = ${e}`);
            await this.errorRestartRound();
            return;
        }

        this.startGuessTimeout(messageContext);

        // song finished without being guessed
        this.connection.once("end", async () => {
            // replace listener with no-op to catch any exceptions thrown after this event
            this.connection.removeAllListeners("end");
            this.connection.on("end", () => {});
            logger.info(
                `${getDebugLogHeader(
                    messageContext
                )} | Song finished without being guessed.`
            );
            this.stopGuessTimeout();

            await this.endRound(
                new MessageContext(this.textChannelID, null, this.guildID),
                { correct: false }
            );

            this.startRound(messageContext);
        });

        this.connection.once("error", (err) => {
            // replace listener with no-op to catch any exceptions thrown after this event
            this.connection.removeAllListeners("error");
            this.connection.on("error", () => {});
            logger.error(
                `${getDebugLogHeader(
                    messageContext
                )} | Unknown error with stream dispatcher. song = ${this.getDebugSongDetails()}. err = ${err}`
            );
            this.errorRestartRound();
        });
    }

    protected getSongCount(): { count: number; countBeforeLimit: number } {
        const selectedSongs = this.songSelector.getSongs();
        return {
            count: selectedSongs.songs.size,
            countBeforeLimit: selectedSongs.countBeforeLimit,
        };
    }

    /**
     * Handles common reasons for why an interaction would not succeed in a session
     * @param interaction - The interaction
     * @param _messageContext - Unused
     * @returns whether to continue with handling the interaction
     */
    protected handleInSessionInteractionFailures(
        interaction: Eris.ComponentInteraction,
        _messageContext: MessageContext
    ): boolean {
        if (!this.round) {
            return false;
        }

        const round = this.round;
        if (
            !getCurrentVoiceMembers(this.voiceChannelID)
                .map((x) => x.id)
                .includes(interaction.member.id)
        ) {
            tryInteractionAcknowledge(interaction);
            return false;
        }

        if (!round.isValidInteraction(interaction.data.custom_id)) {
            tryCreateInteractionErrorAcknowledgement(
                interaction,
                LocalizationManager.localizer.translate(
                    this.guildID,
                    "misc.failure.interaction.optionFromPreviousRound"
                )
            );
            return false;
        }

        return true;
    }

    protected updateBookmarkSongList(): void {
        const round = this.round;
        if (!round) return;

        if (Object.keys(this.songMessageIDs).length === BOOKMARK_MESSAGE_SIZE) {
            this.songMessageIDs.shift();
        }

        if (round.roundMessageID) {
            this.songMessageIDs.push({
                messageID: round.roundMessageID,
                song: round.song,
            });
        }
    }

    /**
     * @returns Debug string containing basic information about the Round
     */
    private getDebugSongDetails(): string {
        if (!this.round) return "No active game round";
        return `${this.round.song.songName}:${this.round.song.artistName}:${this.round.song.youtubeLink}`;
    }

    /**
     * Sends a message displaying song/game related information
     * @param messageContext - An object to pass along relevant parts of Eris.Message
     * @param fields - The embed fields
     * @param round - The round
     * @param description - The description
     * @param embedColor - The embed color
     * @param shouldReply - Whether it should be a reply
     * @param timeRemaining - The time remaining
     * @returns the message
     */
    // eslint-disable-next-line @typescript-eslint/member-ordering
    protected async sendRoundMessage(
        messageContext: MessageContext,
        fields: Eris.EmbedField[],
        round: Round,
        description: string,
        embedColor: number,
        shouldReply: boolean,
        timeRemaining?: number
    ): Promise<Eris.Message<Eris.TextableChannel>> {
        const fact =
            Math.random() <= 0.05 ? getFact(messageContext.guildID) : null;

        if (fact) {
            fields.push({
                name: underline(
                    LocalizationManager.localizer.translate(
                        messageContext.guildID,
                        "fact.didYouKnow"
                    )
                ),
                value: fact,
                inline: false,
            });
        }

        const locale = State.getGuildLocale(messageContext.guildID);

        const songAndArtist = bold(
            `"${getLocalizedSongName(
                round.song,
                locale
            )}" - ${getLocalizedArtistName(round.song, locale)}`
        );

        const embed: EmbedPayload = {
            color: embedColor,
            title: `${songAndArtist} (${round.song.publishDate.getFullYear()})`,
            url: `https://youtu.be/${round.song.youtubeLink}`,
            description,
            fields,
        };

        const views = `${friendlyFormattedNumber(
            round.song.views
        )} ${LocalizationManager.localizer.translate(
            messageContext.guildID,
            "misc.views"
        )}\n`;

        const aliases = this.getAliasFooter(
            this.guildPreference.gameOptions.guessModeType,
            locale
        );

        const duration = this.getDurationFooter(
            locale,
            timeRemaining,
            [views, aliases].every((x) => x.length > 0)
        );

        const footerText = `${views}${aliases}${duration}`;
        const thumbnailUrl = `https://img.youtube.com/vi/${round.song.youtubeLink}/hqdefault.jpg`;
        if (round instanceof GameRound) {
            if (
                this.guildPreference.isMultipleChoiceMode() &&
                round.interactionMessage
            ) {
                embed["thumbnail"] = { url: thumbnailUrl };
                embed["footer"] = { text: footerText };
                await round.interactionMessage.edit({
                    embeds: [embed as Object],
                });
                return round.interactionMessage;
            }
        }

        if (round instanceof ListeningRound) {
            const buttons: Array<Eris.InteractionButton> = [];
            round.interactionSkipUUID = uuid.v4();
            buttons.push({
                type: 2,
                style: 1,
                label: LocalizationManager.localizer.translate(
                    messageContext.guildID,
                    "misc.skip"
                ),
                custom_id: round.interactionSkipUUID,
            });

            buttons.push({
                type: 2,
                style: 1,
                label: LocalizationManager.localizer.translate(
                    messageContext.guildID,
                    "misc.bookmark"
                ),
                custom_id: "bookmark",
            });

            round.interactionComponents = [{ type: 1, components: buttons }];
            embed.components = round.interactionComponents;
        }

        embed.thumbnailUrl = thumbnailUrl;
        embed.footerText = footerText;
        return sendInfoMessage(messageContext, embed, shouldReply, false);
    }

    // eslint-disable-next-line class-methods-use-this
    private getDurationFooter(
        locale: LocaleType,
        timeRemaining: number,
        nonEmptyFooter: boolean
    ): string {
        if (!timeRemaining) {
            return "";
        }

        let durationText = "";
        if (nonEmptyFooter) {
            durationText += "\n";
        }

        durationText +=
            timeRemaining > 0
                ? `⏰ ${LocalizationManager.localizer.translateNByLocale(
                      locale,
                      "misc.plural.minuteRemaining",
                      Math.ceil(timeRemaining)
                  )}`
                : `⏰ ${LocalizationManager.localizer.translateByLocale(
                      locale,
                      "misc.timeFinished"
                  )}!`;

        return durationText;
    }

    /**
     * Attempt to restart game with different song
     */
    private async errorRestartRound(): Promise<void> {
        const messageContext = new MessageContext(this.textChannelID);
        await this.endRound(null, {
            correct: false,
            error: true,
        });

        await sendErrorMessage(messageContext, {
            title: LocalizationManager.localizer.translate(
                this.guildID,
                "misc.failure.songPlaying.title"
            ),
            description: LocalizationManager.localizer.translate(
                this.guildID,
                "misc.failure.songPlaying.description"
            ),
        });
        this.roundsPlayed--;
        this.startRound(messageContext);
    }

    private getAliasFooter(
        guessModeType: GuessModeType,
        locale: LocaleType
    ): string {
        const aliases: Array<string> = [];
        if (guessModeType === GuessModeType.ARTIST) {
            if (this.round.song.hangulArtistName) {
                if (locale === LocaleType.KO) {
                    aliases.push(this.round.song.artistName);
                } else {
                    aliases.push(this.round.song.hangulArtistName);
                }
            }

            aliases.push(...this.round.artistAliases);
        } else {
            if (this.round.song.hangulSongName) {
                if (locale === LocaleType.KO) {
                    aliases.push(this.round.song.originalSongName);
                } else {
                    aliases.push(this.round.song.originalHangulSongName);
                }
            }

            aliases.push(...this.round.songAliases);
        }

        if (aliases.length === 0) {
            return "";
        }

        const aliasesText = LocalizationManager.localizer.translateByLocale(
            locale,
            "misc.inGame.aliases"
        );

        return `${aliasesText}: ${aliases.join(", ")}`;
    }
}
