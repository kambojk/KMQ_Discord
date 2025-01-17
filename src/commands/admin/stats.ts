import { IPCLogger } from "../../logger";
import { KmqImages } from "../../constants";
import {
    friendlyFormattedDate,
    friendlyFormattedNumber,
    measureExecutionTime,
} from "../../helpers/utils";
import {
    getDebugLogHeader,
    sendErrorMessage,
    sendInfoMessage,
} from "../../helpers/discord_utils";
import LocalizationManager from "../../helpers/localization_manager";
import MessageContext from "../../structures/message_context";
import State from "../../state";
import dbContext from "../../database_context";
import os from "os";
import type BaseCommand from "../interfaces/base_command";
import type CommandArgs from "../../interfaces/command_args";
import type Eris from "eris";
import type HelpDocumentation from "../../interfaces/help";

const logger = new IPCLogger("stats");

export default class StatsCommand implements BaseCommand {
    help = (guildID: string): HelpDocumentation => ({
        name: "stats",
        description: LocalizationManager.localizer.translate(
            guildID,
            "command.stats.help.description"
        ),
        usage: ",stats",
        examples: [],
        priority: 1,
    });

    call = async ({ message, channel }: CommandArgs): Promise<void> => {
        const fleetStats = await State.ipc.getStats();
        let gameSessionStats;
        try {
            gameSessionStats = Array.from(
                (
                    (await State.ipc.allClustersCommand(
                        "game_session_stats",
                        true,
                        5000
                    )) as Map<number, any>
                ).values()
            );
        } catch (e) {
            logger.error(`Error retrieving stats via IPC. err = ${e}`);
            sendErrorMessage(MessageContext.fromMessage(message), {
                title: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.stats.failure.title"
                ),
                description: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.stats.failure.description"
                ),
            });
            return;
        }

        const activeGameSessions = gameSessionStats.reduce(
            (x, y) => x + y.activeGameSessions,
            0
        );

        const activePlayers = gameSessionStats.reduce(
            (x, y) => x + y.activePlayers,
            0
        );

        const dateThreshold = new Date();
        dateThreshold.setHours(dateThreshold.getHours() - 24);
        const recentGameSessions = (
            await dbContext
                .kmq("game_sessions")
                .where("start_date", ">", dateThreshold)
                .count("* as count")
                .first()
        ).count;

        const totalGameSessions = (
            await dbContext.kmq("game_sessions").count("* as count").first()
        ).count;

        const recentGameRounds =
            (
                await dbContext
                    .kmq("game_sessions")
                    .where("start_date", ">", dateThreshold)
                    .sum("rounds_played as total")
                    .first()
            ).total || 0;

        const totalGameRounds =
            (
                await dbContext
                    .kmq("game_sessions")
                    .sum("rounds_played as total")
                    .first()
            ).total || 0;

        const recentPlayers = (
            await dbContext
                .kmq("player_stats")
                .where("last_active", ">", dateThreshold)
                .count("* as count")
                .first()
        ).count;

        const totalPlayers = (
            await dbContext
                .kmq("player_stats")
                .count("* as count")
                .where("exp", ">", "0")
                .first()
        ).count;

        const latestAvailableSong = new Date(
            (
                await dbContext
                    .kmq("available_songs")
                    .select("publishedon")
                    .orderBy("publishedon", "DESC")
                    .first()
            ).publishedon
        );

        const mysqlLatency = await measureExecutionTime(
            dbContext.kmq.raw("SELECT 1;")
        );

        const requestLatency = (
            await dbContext
                .kmq("system_stats")
                .select("stat_value")
                .where("stat_name", "=", "request_latency")
                .orderBy("date", "DESC")
                .first()
        )["stat_value"];

        const gameStatistics = {
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.game.activeGameSessions"
            )]: activeGameSessions,
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.game.activePlayers"
            )]: activePlayers,
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.game.recentGameSessions"
            )]: `${friendlyFormattedNumber(
                Number(recentGameSessions)
            )} | ${friendlyFormattedNumber(Number(totalGameSessions))}`,
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.game.recentGameRounds"
            )]: `${friendlyFormattedNumber(
                recentGameRounds
            )} | ${friendlyFormattedNumber(totalGameRounds)}`,
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.game.recentPlayers"
            )]: `${friendlyFormattedNumber(
                Number(recentPlayers)
            )} | ${friendlyFormattedNumber(Number(totalPlayers))}`,
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.game.latestSongUpdate"
            )]: friendlyFormattedDate(latestAvailableSong, message.guildID),
        };

        const systemStatistics = {
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.system.loadAverage"
            )]: os
                .loadavg()
                .map((x) => x.toFixed(2))
                .toString(),
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.system.memoryUsage"
            )]: `${fleetStats.totalRam.toFixed(2)} MB`,
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.system.apiLatency"
            )]: `${
                !Number.isFinite(channel.guild.shard.latency)
                    ? "?"
                    : channel.guild.shard.latency
            } ms`,
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.system.requestLatency"
            )]: `${requestLatency} ms`,
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.system.databaseLatency"
            )]: `${mysqlLatency.toFixed(2)} ms`,
            [LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.system.uptime"
            )]: LocalizationManager.localizer.translateN(
                message.guildID,
                "misc.plural.hour",
                Number((process.uptime() / (60 * 60)).toFixed(2))
            ),
        };

        const fields: Array<Eris.EmbedField> = [
            {
                name: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.stats.game.title"
                ),
                value: `\`\`\`\n${Object.entries(gameStatistics)
                    .map((stat) => `${stat[0]}: ${stat[1]}`)
                    .join("\n")}\`\`\``,
            },
            {
                name: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.stats.system.title"
                ),
                value: `\`\`\`\n${Object.entries(systemStatistics)
                    .map((stat) => `${stat[0]}: ${stat[1]}`)
                    .join("\n")}\`\`\``,
            },
        ];

        logger.info(`${getDebugLogHeader(message)} | Stats retrieved`);
        sendInfoMessage(MessageContext.fromMessage(message), {
            title: LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.title"
            ),
            description: LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.description",
                {
                    link: "https://kmq.kpop.gg/status",
                }
            ),
            fields,
            footerText: `${
                State.version
            } | ${LocalizationManager.localizer.translate(
                message.guildID,
                "command.stats.footer"
            )}`,
            timestamp: new Date(),
            thumbnailUrl: KmqImages.READING_BOOK,
        });
    };
}
