import type Eris from "eris";
import { chooseRandom } from "../helpers/utils";
import {
    getCurrentVoiceMembers,
    sendRoundMessage,
    tryCreateInteractionSuccessAcknowledgement,
    getMajorityCount,
    getDebugLogHeader,
} from "../helpers/discord_utils";
import KmqMember from "./kmq_member";
import type Round from "./round";
import Session from "./session";
import MusicRound from "./music_round";
import type GuildPreference from "./guild_preference";
import type MessageContext from "./message_context";
import { IPCLogger } from "../logger";
import { isUserPremium } from "../helpers/game_utils";
import { isSkipMajority, skipSong } from "../commands/game_commands/skip";
import State from "../state";
import { getGuildPreference } from "../helpers/game_utils";
import type QueriedSong from "../interfaces/queried_song";
import type GuessResult from "../interfaces/guess_result";

const logger = new IPCLogger("music_session");

export default class MusicSession extends Session {
    /** The current MusicRound */
    public round: MusicRound;

    constructor(
        textChannelID: string,
        voiceChannelID: string,
        guildID: string,
        gameSessionCreator: KmqMember
    ) {
        super(textChannelID, voiceChannelID, guildID, gameSessionCreator);
        this.round = null;
    }

    updateOwner(): void {
        if (this.finished) {
            return;
        }

        const voiceMembers = getCurrentVoiceMembers(this.voiceChannelID).filter(
            (x) => x.id !== process.env.BOT_CLIENT_ID
        );

        const voiceMemberIDs = new Set(voiceMembers.map((x) => x.id));
        if (voiceMemberIDs.has(this.owner.id) || voiceMemberIDs.size === 0) {
            return;
        }

        this.owner = KmqMember.fromUser(chooseRandom(voiceMembers));

        super.updateOwner();
    }

    isMusicSession(): boolean {
        return true;
    }

    /**
     * Starting a new MusicRound
     * @param guildPreference - The guild's GuildPreference
     * @param messageContext - An object containing relevant parts of Eris.Message
     */
    async startRound(
        guildPreference: GuildPreference,
        messageContext: MessageContext
    ): Promise<void> {
        if (this.finished || this.round) {
            return;
        }

        await super.startRound(guildPreference, messageContext);

        if (messageContext) {
            const remainingDuration =
                this.getRemainingDuration(guildPreference);

            const startRoundMessage = await sendRoundMessage(
                messageContext,
                null,
                this,
                guildPreference.gameOptions.guessModeType,
                guildPreference.isMultipleChoiceMode(),
                remainingDuration,
                this.songSelector.getUniqueSongCounter(guildPreference)
            );

            this.round.interactionMessage = startRoundMessage;
            this.round.roundMessageID = startRoundMessage?.id;
            this.updateBookmarkSongList();
        }
    }

    async endRound(
        guildPreference: GuildPreference,
        messageContext?: MessageContext,
        guessResult?: GuessResult
    ): Promise<void> {
        await this.round?.interactionMarkButtons();
        super.endRound(guildPreference, messageContext, guessResult);
    }

    endSession(): Promise<void> {
        if (this.finished) {
            return;
        }

        this.finished = true;
        logger.info(
            `gid: ${this.guildID} | Music session ended. rounds_played = ${this.roundsPlayed}`
        );
        super.endSession();
    }

    async handleButtonInteraction(
        interaction: Eris.ComponentInteraction,
        messageContext: MessageContext
    ): Promise<void> {
        if (
            interaction.data.custom_id !== "bookmark" &&
            !this.handleInSessionInteractionFailures(
                interaction,
                messageContext
            )
        ) {
            return;
        }

        const guildID = interaction.guildID;
        if (interaction.data.custom_id === "bookmark") {
            this.handleBookmarkInteraction(interaction);
        } else if (
            interaction.data.custom_id === this.round.interactionSkipUUID
        ) {
            this.round.userSkipped(interaction.member.id);
            if (isSkipMajority(guildID, this)) {
                await this.round.interactionSuccessfulSkip();
                await tryCreateInteractionSuccessAcknowledgement(
                    interaction,
                    State.localizer.translate(guildID, "misc.skip"),
                    State.localizer.translate(
                        guildID,
                        "command.skip.success.description",
                        {
                            skipCounter: `${this.round.getSkipCount()}/${getMajorityCount(
                                guildID
                            )}`,
                        }
                    )
                );

                skipSong(
                    messageContext,
                    this,
                    await getGuildPreference(guildID)
                );
            } else {
                tryCreateInteractionSuccessAcknowledgement(
                    interaction,
                    State.localizer.translate(
                        guildID,
                        "command.skip.vote.title"
                    ),
                    State.localizer.translate(
                        guildID,
                        "command.skip.vote.description",
                        {
                            skipCounter: `${this.round.getSkipCount()}/${getMajorityCount(
                                guildID
                            )}`,
                        }
                    )
                );

                logger.info(
                    `${getDebugLogHeader(messageContext)} | Skip vote received.`
                );
            }
        }
    }

    /**
     * Whether the current music session has premium features
     * @returns whether the session is premium
     */
    isPremium(): boolean {
        return getCurrentVoiceMembers(this.voiceChannelID).some((x) =>
            isUserPremium(x.id)
        );
    }

    /**
     * Prepares a new GameRound
     * @param randomSong - The queried song
     * @returns the new GameRound
     */
    protected prepareRound(randomSong: QueriedSong): Round {
        return new MusicRound(randomSong);
    }
}