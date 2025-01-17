import { IPCLogger } from "../../logger";
import { KmqImages } from "../../constants";
import {
    chunkArray,
    friendlyFormattedDate,
    friendlyFormattedNumber,
    isValidURL,
} from "../../helpers/utils";
import {
    getDebugLogHeader,
    sendErrorMessage,
    sendInfoMessage,
    sendPaginationedEmbed,
} from "../../helpers/discord_utils";
import {
    getLocalizedArtistName,
    getLocalizedSongName,
    isPremiumRequest,
} from "../../helpers/game_utils";
import { getVideoID, validateID } from "ytdl-core";
import { sendValidationErrorMessage } from "../../helpers/validate";
import GuildPreference from "../../structures/guild_preference";
import LocaleType from "../../enums/locale_type";
import LocalizationManager from "../../helpers/localization_manager";
import MessageContext from "../../structures/message_context";
import Session from "../../structures/session";
import SongSelector from "../../structures/song_selector";
import State from "../../state";
import dbContext from "../../database_context";
import type { EmbedOptions } from "eris";
import type { GuildTextableMessage } from "../../types";
import type BaseCommand from "../interfaces/base_command";
import type CommandArgs from "../../interfaces/command_args";
import type HelpDocumentation from "../../interfaces/help";
import type QueriedSong from "../../interfaces/queried_song";

const logger = new IPCLogger("lookup");

const getDaisukiLink = (id: string, isMV: boolean): string => {
    if (isMV) {
        return `https://kpop.daisuki.com.br/mv.html?id=${id}`;
    }

    return `https://kpop.daisuki.com.br/audio_videos.html?playid=${id}`;
};

async function lookupByYoutubeID(
    message: GuildTextableMessage,
    videoID: string,
    locale: LocaleType
): Promise<boolean> {
    const messageContext = MessageContext.fromMessage(message);
    const guildID = message.guildID;
    const kmqSongEntry: QueriedSong = await dbContext
        .kmq("available_songs")
        .select(SongSelector.getQueriedSongFields())
        .where("link", videoID)
        .first();

    const daisukiMVEntry = await dbContext
        .kpopVideos("app_kpop")
        .where("vlink", videoID)
        .first();

    const daisukiAudioEntry = await dbContext
        .kpopVideos("app_kpop_audio")
        .where("vlink", videoID)
        .first();

    const daisukiSongEntry = daisukiMVEntry || daisukiAudioEntry;
    if (!daisukiSongEntry) {
        // maybe it was falsely parsed as video ID? fallback to song name lookup
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const found = await lookupBySongName(videoID, locale, message, guildID);
        if (found) {
            logger.info(
                `Lookup succeded through fallback lookup for: ${videoID}`
            );
            return true;
        }

        return false;
    }

    const daisukiLink = getDaisukiLink(daisukiSongEntry.id, !!daisukiMVEntry);

    let description: string;
    let songName: string;
    let artistName: string;
    let songAliases: string;
    let artistAliases: string;
    let views: number;
    let publishDate: Date;
    let songDuration: string;
    let includedInOptions = false;

    if (kmqSongEntry) {
        description = LocalizationManager.localizer.translate(
            guildID,
            "command.lookup.inKMQ",
            { link: daisukiLink }
        );
        songName = getLocalizedSongName(kmqSongEntry, locale);
        artistName = getLocalizedArtistName(kmqSongEntry, locale);
        songAliases = State.aliases.song[videoID]?.join(", ");
        artistAliases =
            State.aliases.artist[kmqSongEntry.artistName]?.join(", ");
        views = kmqSongEntry.views;
        publishDate = kmqSongEntry.publishDate;

        const durationInSeconds = (
            await dbContext
                .kmq("cached_song_duration")
                .where("vlink", videoID)
                .first()
        )?.duration;

        // duration in minutes and seconds
        if (durationInSeconds) {
            const minutes = Math.floor(durationInSeconds / 60);
            const seconds = durationInSeconds % 60;
            songDuration = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
        }

        const session = Session.getSession(guildID);
        includedInOptions = [
            ...(
                await SongSelector.getFilteredSongList(
                    await GuildPreference.getGuildPreference(guildID),
                    await isPremiumRequest(session, message.author.id)
                )
            ).songs,
        ]
            .map((x) => x.youtubeLink)
            .includes(videoID);

        logger.info(
            `${getDebugLogHeader(
                message
            )} | KMQ song lookup. videoID = ${videoID}. Included in options = ${includedInOptions}.`
        );
    } else {
        description = LocalizationManager.localizer.translate(
            guildID,
            "command.lookup.notInKMQ",
            { link: daisukiLink }
        );
        const isKorean = locale === LocaleType.KO;
        songName =
            daisukiSongEntry.kname && isKorean
                ? daisukiSongEntry.kname
                : daisukiSongEntry.name;

        const artistNameQuery = await dbContext
            .kpopVideos("app_kpop_group")
            .select("name", "kname")
            .where("id", daisukiSongEntry.id_artist)
            .first();

        artistName =
            artistNameQuery.kname && isKorean
                ? artistNameQuery.kname
                : artistNameQuery.name;

        songAliases = [...daisukiSongEntry.name_aka.split(";")].join(", ");
        songAliases += songAliases
            ? `, ${daisukiSongEntry.kname}`
            : daisukiSongEntry.kname;

        artistAliases = State.aliases.artist[artistNameQuery.name]?.join(", ");

        views = daisukiSongEntry.views;
        publishDate = new Date(daisukiSongEntry.publishedon);

        logger.info(
            `${getDebugLogHeader(
                message
            )} | Non-KMQ song lookup. videoID = ${videoID}.`
        );
    }

    const viewsString = LocalizationManager.localizer.translate(
        guildID,
        "misc.views"
    );

    const fields = [
        {
            name: viewsString[0].toUpperCase() + viewsString.slice(1),
            value: friendlyFormattedNumber(views),
        },
        {
            name: LocalizationManager.localizer.translate(
                guildID,
                "misc.releaseDate"
            ),
            value: friendlyFormattedDate(publishDate, guildID),
        },
        {
            name: LocalizationManager.localizer.translate(
                guildID,
                "misc.songAliases"
            ),
            value:
                songAliases ||
                LocalizationManager.localizer.translate(guildID, "misc.none"),
        },
        {
            name: LocalizationManager.localizer.translate(
                guildID,
                "misc.artistAliases"
            ),
            value:
                artistAliases ||
                LocalizationManager.localizer.translate(guildID, "misc.none"),
        },
    ];

    if (kmqSongEntry) {
        fields.push(
            {
                name: LocalizationManager.localizer.translate(
                    guildID,
                    "misc.duration"
                ),
                value:
                    songDuration ||
                    LocalizationManager.localizer.translate(
                        guildID,
                        "misc.notApplicable"
                    ),
            },
            {
                name: LocalizationManager.localizer.translate(
                    guildID,
                    "command.lookup.inCurrentGameOptions"
                ),
                value: LocalizationManager.localizer.translate(
                    guildID,
                    includedInOptions ? "misc.yes" : "misc.no"
                ),
            }
        );
    }

    sendInfoMessage(messageContext, {
        title: `${songName} - ${artistName}`,
        url: `https://youtu.be/${videoID}`,
        description,
        thumbnailUrl: `https://img.youtube.com/vi/${videoID}/hqdefault.jpg`,
        fields: fields.map((x) => ({
            name: x.name,
            value: x.value,
            inline: true,
        })),
    });

    return true;
}

async function lookupBySongName(
    songName: string,
    locale: LocaleType,
    message: GuildTextableMessage,
    guildID: string
): Promise<boolean> {
    const kmqSongEntries: QueriedSong[] = await dbContext
        .kmq("available_songs")
        .select(SongSelector.getQueriedSongFields())
        .whereILike("song_name_en", `%${songName}%`)
        .orWhereILike("song_name_ko", `%${songName}%`)
        .orderByRaw("CHAR_LENGTH(song_name_en) ASC")
        .orderBy("views", "DESC")
        .limit(100);

    if (kmqSongEntries.length === 0) {
        return false;
    }

    if (kmqSongEntries.length === 1) {
        return lookupByYoutubeID(
            message,
            kmqSongEntries[0].youtubeLink,
            locale
        );
    }

    const songEmbeds = kmqSongEntries.map((entry) => ({
        name: `**"${getLocalizedSongName(
            entry,
            locale
        )}"** - ${getLocalizedArtistName(entry, locale)}`,
        value: `https://youtu.be/${entry.youtubeLink}`,
    }));

    const embedFieldSubsets = chunkArray(songEmbeds, 5);
    const embeds: Array<EmbedOptions> = embedFieldSubsets.map(
        (embedFieldsSubset) => ({
            title: LocalizationManager.localizer.translate(
                guildID,
                "command.lookup.songNameSearchResult.title"
            ),
            description: LocalizationManager.localizer.translate(
                guildID,
                "command.lookup.songNameSearchResult.successDescription"
            ),
            fields: embedFieldsSubset,
        })
    );

    await sendPaginationedEmbed(message, embeds);
    return true;
}

export default class LookupCommand implements BaseCommand {
    aliases = ["songinfo", "songlookup"];
    validations = {
        minArgCount: 1,
        arguments: [],
    };

    help = (guildID: string): HelpDocumentation => ({
        name: "lookup",
        description: LocalizationManager.localizer.translate(
            guildID,
            "command.lookup.help.description"
        ),
        usage: ",lookup [song_name | youtube_id]",
        examples: [
            {
                example: "`,lookup love dive`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.lookup.help.example.song",
                    { song: "Love Dive", artist: "IVE" }
                ),
            },
            {
                example:
                    "`,lookup https://www.youtube.com/watch?v=4TWR90KJl84`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.lookup.help.example.song",
                    { song: "Next Level", artist: "Aespa" }
                ),
            },
        ],
        priority: 40,
    });

    call = async ({ parsedMessage, message }: CommandArgs): Promise<void> => {
        const guildID = message.guildID;
        let arg = parsedMessage.components[0];

        const locale = State.getGuildLocale(guildID);

        if (arg.startsWith("<") && arg.endsWith(">")) {
            // Trim <> if user didn't want to show YouTube embed
            arg = arg.slice(1, -1);
        }

        if (arg.startsWith("youtube.com") || arg.startsWith("youtu.be")) {
            // ytdl::getVideoID() requires URLs start with "https://"
            arg = `https://${arg}`;
        }

        const messageContext = MessageContext.fromMessage(message);

        // attempt to look up by video ID
        if (isValidURL(arg) || validateID(arg)) {
            let videoID: string = null;

            try {
                videoID = getVideoID(arg);
            } catch {
                await sendValidationErrorMessage(
                    message,
                    LocalizationManager.localizer.translate(
                        guildID,
                        "command.lookup.validation.invalidYouTubeID"
                    ),
                    parsedMessage.components[0],
                    this.help(guildID).usage
                );

                logger.info(
                    `${getDebugLogHeader(
                        message
                    )} | Invalid YouTube ID passed. arg = ${arg}.`
                );
                return;
            }

            if (!(await lookupByYoutubeID(message, videoID, locale))) {
                await sendErrorMessage(messageContext, {
                    title: LocalizationManager.localizer.translate(
                        guildID,
                        "command.lookup.notFound.title"
                    ),
                    description: LocalizationManager.localizer.translate(
                        guildID,
                        "command.lookup.notFound.description"
                    ),
                    thumbnailUrl: KmqImages.DEAD,
                });

                logger.info(
                    `${getDebugLogHeader(
                        messageContext
                    )} | Could not find song by videoID. videoID = ${videoID}.`
                );
            }
        } else {
            // lookup by song name
            // eslint-disable-next-line no-lonely-if
            if (
                !(await lookupBySongName(
                    parsedMessage.argument,
                    locale,
                    message,
                    guildID
                ))
            ) {
                await sendInfoMessage(messageContext, {
                    title: LocalizationManager.localizer.translate(
                        guildID,
                        "command.lookup.songNameSearchResult.title"
                    ),
                    description: LocalizationManager.localizer.translate(
                        guildID,
                        "command.lookup.songNameSearchResult.notFoundDescription"
                    ),
                });

                logger.info(
                    `Could not find song by song name. songName = ${parsedMessage.argument}`
                );
            }
        }
    };
}
