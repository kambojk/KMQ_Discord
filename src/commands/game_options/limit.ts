import { DEFAULT_LIMIT } from "../../constants";
import { IPCLogger } from "../../logger";
import {
    getDebugLogHeader,
    sendErrorMessage,
    sendOptionsMessage,
} from "../../helpers/discord_utils";
import CommandPrechecks from "../../command_prechecks";
import GameOption from "../../enums/game_option_name";
import GuildPreference from "../../structures/guild_preference";
import LocalizationManager from "../../helpers/localization_manager";
import MessageContext from "../../structures/message_context";
import Session from "../../structures/session";
import type BaseCommand from "../interfaces/base_command";
import type CommandArgs from "../../interfaces/command_args";
import type HelpDocumentation from "../../interfaces/help";

const logger = new IPCLogger("limit");

export default class LimitCommand implements BaseCommand {
    preRunChecks = [{ checkFn: CommandPrechecks.competitionPrecheck }];

    validations = {
        minArgCount: 0,
        maxArgCount: 2,
        arguments: [
            {
                name: "limit_1",
                type: "number" as const,
                minValue: 0,
                maxValue: 100000,
            },
            {
                name: "limit_2",
                type: "number" as const,
                minValue: 1,
                maxValue: 100000,
            },
        ],
    };

    help = (guildID: string): HelpDocumentation => ({
        name: "limit",
        description: LocalizationManager.localizer.translate(
            guildID,
            "command.limit.help.description"
        ),
        usage: ",limit [limit_1] {limit_2}",
        examples: [
            {
                example: "`,limit 250`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.limit.help.example.singleLimit",
                    {
                        limit: String(250),
                    }
                ),
            },
            {
                example: "`,limit 250 500`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.limit.help.example.twoLimits",
                    { limitStart: String(250), limitEnd: String(500) }
                ),
            },
            {
                example: "`,limit`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.limit.help.example.reset",
                    { defaultLimit: `\`${DEFAULT_LIMIT}\`` }
                ),
            },
        ],
        priority: 140,
    });

    call = async ({ message, parsedMessage }: CommandArgs): Promise<void> => {
        const guildPreference = await GuildPreference.getGuildPreference(
            message.guildID
        );

        if (parsedMessage.components.length === 0) {
            await guildPreference.reset(GameOption.LIMIT);
            await sendOptionsMessage(
                Session.getSession(message.guildID),
                MessageContext.fromMessage(message),
                guildPreference,
                [{ option: GameOption.LIMIT, reset: true }]
            );
            logger.info(`${getDebugLogHeader(message)} | Limit reset.`);
            return;
        }

        let limitStart: number;
        let limitEnd: number;
        if (parsedMessage.components.length === 1) {
            limitStart = 0;
            limitEnd = parseInt(parsedMessage.components[0], 10);
            if (limitEnd === 0) {
                sendErrorMessage(MessageContext.fromMessage(message), {
                    title: LocalizationManager.localizer.translate(
                        message.guildID,
                        "command.limit.failure.invalidLimit.title"
                    ),
                    description: LocalizationManager.localizer.translate(
                        message.guildID,
                        "command.limit.failure.invalidLimit.greaterThanZero.description"
                    ),
                });
                return;
            }
        } else {
            limitStart = parseInt(parsedMessage.components[0], 10);
            limitEnd = parseInt(parsedMessage.components[1], 10);
            if (limitEnd <= limitStart) {
                sendErrorMessage(MessageContext.fromMessage(message), {
                    title: LocalizationManager.localizer.translate(
                        message.guildID,
                        "command.limit.failure.invalidLimit.title"
                    ),
                    description: LocalizationManager.localizer.translate(
                        message.guildID,
                        "command.limit.failure.invalidLimit.greaterThanStart.description"
                    ),
                });
                return;
            }
        }

        await guildPreference.setLimit(limitStart, limitEnd);
        await sendOptionsMessage(
            Session.getSession(message.guildID),
            MessageContext.fromMessage(message),
            guildPreference,
            [{ option: GameOption.LIMIT, reset: false }]
        );

        logger.info(
            `${getDebugLogHeader(message)} | Limit set to ${
                guildPreference.gameOptions.limitStart
            } - ${guildPreference.gameOptions.limitEnd}`
        );
    };
}
