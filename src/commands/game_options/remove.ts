import { GROUP_LIST_URL } from "../../constants";
import { IPCLogger } from "../../logger";
import {
    getDebugLogHeader,
    sendErrorMessage,
    sendOptionsMessage,
} from "../../helpers/discord_utils";
import {
    getMatchingGroupNames,
    getSimilarGroupNames,
} from "../../helpers/game_utils";
import CommandPrechecks from "../../command_prechecks";
import GameOption from "../../enums/game_option_name";
import GuildPreference from "../../structures/guild_preference";
import LocalizationManager from "../../helpers/localization_manager";
import MessageContext from "../../structures/message_context";
import Session from "../../structures/session";
import State from "../../state";
import type BaseCommand from "../interfaces/base_command";
import type CommandArgs from "../../interfaces/command_args";
import type HelpDocumentation from "../../interfaces/help";
import type MatchedArtist from "../../interfaces/matched_artist";

const logger = new IPCLogger("remove");

enum RemoveType {
    // Groups with aliases
    GROUPS = "groups",
    GROUP = "group",
    ARTIST = "artist",
    ARTISTS = "artists",

    // Exclude with aliases
    EXCLUDE = "exclude",
    EXCLUDES = "excludes",

    // Include with aliases
    INCLUDE = "include",
    INCLUDES = "includes",
}

export default class RemoveCommand implements BaseCommand {
    preRunChecks = [{ checkFn: CommandPrechecks.competitionPrecheck }];

    validations = {
        minArgCount: 2,
        arguments: [
            {
                name: "option",
                type: "enum" as const,
                enums: Object.values(RemoveType),
            },
        ],
    };

    help = (guildID: string): HelpDocumentation => ({
        name: "remove",
        description: LocalizationManager.localizer.translate(
            guildID,
            "command.remove.help.description",
            {
                groups: `\`${process.env.BOT_PREFIX}groups\``,
                exclude: `\`${process.env.BOT_PREFIX}exclude\``,
                include: `\`${process.env.BOT_PREFIX}include\``,
            }
        ),
        usage: `,remove [groups | exclude | include] [${LocalizationManager.localizer.translate(
            guildID,
            "misc.listOfGroups"
        )}]`,
        examples: [
            {
                example: "`,remove groups twice, red velvet`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.remove.help.example.groups",
                    {
                        groupOne: "Twice",
                        groupTwo: "Red Velvet",
                        groups: `\`${process.env.BOT_PREFIX}groups\``,
                    }
                ),
            },
            {
                example: "`,remove exclude BESTie, Dia, iKON`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.remove.help.example.exclude",
                    {
                        groupOne: "BESTie",
                        groupTwo: "Dia",
                        groupThree: "iKON",
                        exclude: `\`${process.env.BOT_PREFIX}exclude\``,
                    }
                ),
            },
            {
                example: "`,remove include exo`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.remove.help.example.include",
                    {
                        group: "exo",
                        include: `\`${process.env.BOT_PREFIX}include\``,
                    }
                ),
            },
        ],
        actionRowComponents: [
            {
                style: 5 as const,
                url: GROUP_LIST_URL,
                type: 2 as const,
                label: LocalizationManager.localizer.translate(
                    guildID,
                    "misc.interaction.fullGroupsList"
                ),
            },
        ],
        priority: 200,
    });

    call = async ({ message, parsedMessage }: CommandArgs): Promise<void> => {
        const guildPreference = await GuildPreference.getGuildPreference(
            message.guildID
        );

        const optionListed = parsedMessage.components[0] as RemoveType;
        let currentMatchedArtists: MatchedArtist[];
        switch (optionListed) {
            case RemoveType.GROUPS:
            case RemoveType.GROUP:
            case RemoveType.ARTIST:
            case RemoveType.ARTISTS:
                currentMatchedArtists = guildPreference.gameOptions.groups;
                break;
            case RemoveType.INCLUDE:
            case RemoveType.INCLUDES:
                currentMatchedArtists = guildPreference.gameOptions.includes;
                break;
            case RemoveType.EXCLUDE:
            case RemoveType.EXCLUDES:
                currentMatchedArtists = guildPreference.gameOptions.excludes;
                break;
            default:
        }

        if (!currentMatchedArtists) {
            sendErrorMessage(MessageContext.fromMessage(message), {
                title: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.remove.failure.noGroupsSelected.title"
                ),
                description: LocalizationManager.localizer.translate(
                    message.guildID,
                    "command.remove.failure.noGroupsSelected.description"
                ),
            });
            return;
        }

        const rawGroupsToRemove = parsedMessage.argument
            .split(" ")
            .slice(1)
            .join(" ")
            .split(",")
            .map((groupName) => groupName.trim().toLowerCase());

        const { matchedGroups, unmatchedGroups } = await getMatchingGroupNames(
            rawGroupsToRemove
        );

        const remainingGroups = currentMatchedArtists.filter(
            (group) => !matchedGroups.some((x) => x.id === group.id)
        );

        if (unmatchedGroups.length) {
            logger.info(
                `${getDebugLogHeader(
                    message
                )} | Attempted to set unknown groups. groups =  ${unmatchedGroups.join(
                    ", "
                )}`
            );

            let suggestionsText: string = null;
            if (unmatchedGroups.length === 1) {
                const suggestions = await getSimilarGroupNames(
                    unmatchedGroups[0],
                    State.getGuildLocale(message.guildID)
                );

                if (suggestions.length > 0) {
                    suggestionsText = LocalizationManager.localizer.translate(
                        message.guildID,
                        "misc.failure.unrecognizedGroups.didYouMean",
                        {
                            suggestions: suggestions.join("\n"),
                        }
                    );
                }
            }

            const descriptionText = LocalizationManager.localizer.translate(
                message.guildID,
                "misc.failure.unrecognizedGroups.description",
                {
                    matchedGroupsAction:
                        LocalizationManager.localizer.translate(
                            message.guildID,
                            "command.remove.failure.unrecognizedGroups.removed"
                        ),
                    helpGroups: `\`${process.env.BOT_PREFIX}help groups\``,
                    unmatchedGroups: unmatchedGroups.join(", "),
                    solution: "",
                }
            );

            await sendErrorMessage(MessageContext.fromMessage(message), {
                title: LocalizationManager.localizer.translate(
                    message.guildID,
                    "misc.failure.unrecognizedGroups.title"
                ),
                description: `${descriptionText}\n\n${suggestionsText || ""}`,
            });
        }

        // if none of the new groups were matched
        if (unmatchedGroups.length === rawGroupsToRemove.length) {
            return;
        }

        switch (optionListed) {
            case RemoveType.GROUPS:
            case RemoveType.GROUP:
            case RemoveType.ARTIST:
            case RemoveType.ARTISTS:
                await guildPreference.setGroups(remainingGroups);
                await sendOptionsMessage(
                    Session.getSession(message.guildID),
                    MessageContext.fromMessage(message),
                    guildPreference,
                    [{ option: GameOption.GROUPS, reset: false }]
                );

                logger.info(
                    `${getDebugLogHeader(
                        message
                    )} | Group removed: ${rawGroupsToRemove}`
                );
                break;
            case RemoveType.INCLUDE:
            case RemoveType.INCLUDES:
                await guildPreference.setIncludes(remainingGroups);
                await sendOptionsMessage(
                    Session.getSession(message.guildID),
                    MessageContext.fromMessage(message),
                    guildPreference,
                    [{ option: GameOption.INCLUDE, reset: false }]
                );

                logger.info(
                    `${getDebugLogHeader(
                        message
                    )} | Include removed: ${rawGroupsToRemove}`
                );
                break;
            case RemoveType.EXCLUDE:
            case RemoveType.EXCLUDES:
                await guildPreference.setExcludes(remainingGroups);
                await sendOptionsMessage(
                    Session.getSession(message.guildID),
                    MessageContext.fromMessage(message),
                    guildPreference,
                    [{ option: GameOption.EXCLUDE, reset: false }]
                );

                logger.info(
                    `${getDebugLogHeader(
                        message
                    )} | Exclude removed: ${rawGroupsToRemove}`
                );
                break;
            default:
        }
    };
}
