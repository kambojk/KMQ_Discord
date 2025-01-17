import { IPCLogger } from "../../logger";
import { KmqImages } from "../../constants";
import {
    chunkArray,
    friendlyFormattedNumber,
    standardDateFormat,
} from "../../helpers/utils";
import {
    getDebugLogHeader,
    sendInfoMessage,
    sendPaginationedEmbed,
} from "../../helpers/discord_utils";
import {
    getLocalizedArtistName,
    getLocalizedSongName,
} from "../../helpers/game_utils";
import LocalizationManager from "../../helpers/localization_manager";
import MessageContext from "../../structures/message_context";
import State from "../../state";
import dbContext from "../../database_context";
import type { EmbedOptions } from "eris";
import type BaseCommand from "../interfaces/base_command";
import type CommandArgs from "../../interfaces/command_args";
import type HelpDocumentation from "../../interfaces/help";
import type QueriedSong from "../../interfaces/queried_song";

const logger = new IPCLogger("recentlyadded");

const FIELDS_PER_EMBED = 9;

export default class RecentlyAddedCommand implements BaseCommand {
    aliases = ["recent"];

    help = (guildID: string): HelpDocumentation => ({
        name: "recentlyadded",
        description: LocalizationManager.localizer.translate(
            guildID,
            "command.recentlyadded.help.description"
        ),
        usage: ",recentlyadded",
        examples: [
            {
                example: "`,recentlyadded`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.recentlyadded.help.example"
                ),
            },
        ],
        priority: 30,
    });

    call = async ({ message }: CommandArgs): Promise<void> => {
        const newSongs: Array<QueriedSong> = await dbContext
            .kmq("available_songs")
            .select([
                "song_name_en AS originalSongName",
                "song_name_ko AS originalHangulSongName",
                "artist_name_en AS artistName",
                "artist_name_ko AS hangulArtistName",
                "link AS youtubeLink",
                "publishedon AS publishDate",
                "views",
            ])
            .orderBy("publishedon", "DESC")
            .where(
                "publishedon",
                ">=",
                standardDateFormat(
                    new Date(Date.now() - 1000 * 60 * 60 * 24 * 14)
                )
            );

        if (newSongs.length === 0) {
            sendInfoMessage(MessageContext.fromMessage(message), {
                title: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.recentlyadded.failure.noSongs.title"
                ),
                description: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.recentlyadded.failure.noSongs.description"
                ),
                thumbnailUrl: KmqImages.NOT_IMPRESSED,
            });
            return;
        }

        const locale = State.getGuildLocale(message.guildID);
        const fields = newSongs.map((song) => ({
            name: `"${getLocalizedSongName(
                song,
                locale
            )}" - ${getLocalizedArtistName(song, locale)}`,
            value: `${LocalizationManager.localizer.translate(
                message.guildID,
                "command.recentlyadded.released"
            )} ${standardDateFormat(
                song.publishDate
            )}\n[${friendlyFormattedNumber(
                song.views
            )} ${LocalizationManager.localizer.translate(
                message.guildID,
                "misc.views"
            )}](https://youtu.be/${song.youtubeLink})`,
            inline: true,
        }));

        const embedFieldSubsets = chunkArray(fields, FIELDS_PER_EMBED);
        const embeds: Array<EmbedOptions> = embedFieldSubsets.map(
            (embedFieldsSubset) => ({
                title: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.recentlyadded.title"
                ),
                description: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.recentlyadded.description"
                ),
                fields: embedFieldsSubset,
            })
        );

        await sendPaginationedEmbed(message, embeds, null);
        logger.info(
            `${getDebugLogHeader(message)} | Recently added songs retrieved.`
        );
    };
}
