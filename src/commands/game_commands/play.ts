import {
    ELIMINATION_DEFAULT_LIVES,
    EMBED_SUCCESS_BONUS_COLOR,
    KmqImages,
} from "../../constants";
import { IPCLogger } from "../../logger";
import {
    activeBonusUsers,
    areUsersPremium,
    isPowerHour,
    isPremiumRequest,
} from "../../helpers/game_utils";
import {
    generateEmbed,
    generateOptionsMessage,
    getCurrentVoiceMembers,
    getDebugLogHeader,
    getGameInfoMessage,
    getUserVoiceChannel,
    sendErrorMessage,
    sendInfoMessage,
    voicePermissionsCheck,
} from "../../helpers/discord_utils";
import { getMention, isWeekend } from "../../helpers/utils";
import { getTimeUntilRestart } from "../../helpers/management_utils";
import CommandPrechecks from "../../command_prechecks";
import GameSession from "../../structures/game_session";
import GameType from "../../enums/game_type";
import GuildPreference from "../../structures/guild_preference";
import KmqMember from "../../structures/kmq_member";
import LocalizationManager from "../../helpers/localization_manager";
import MessageContext from "../../structures/message_context";
import Session from "../../structures/session";
import State from "../../state";
import dbContext from "../../database_context";
import type BaseCommand from "../interfaces/base_command";
import type CommandArgs from "../../interfaces/command_args";
import type Eris from "eris";
import type HelpDocumentation from "../../interfaces/help";

const logger = new IPCLogger("play");

/**
 * Sends the beginning of game session message
 * @param textChannelName - The name of the text channel to send the message to
 * @param voiceChannelName - The name of the voice channel to join
 * @param messageContext - The original message that triggered the command
 * @param participantIDs - The list of participants
 * @param guildPreference - The guild's game preferences
 */
export async function sendBeginGameSessionMessage(
    textChannelName: string,
    voiceChannelName: string,
    messageContext: MessageContext,
    participantIDs: Array<string>,
    guildPreference: GuildPreference
): Promise<void> {
    const guildID = messageContext.guildID;
    let gameInstructions = LocalizationManager.localizer.translate(
        guildID,
        "command.play.typeGuess"
    );

    const bonusUsers = await activeBonusUsers();
    const bonusUserParticipantIDs = participantIDs.filter((x) =>
        bonusUsers.has(x)
    );

    const isBonus = bonusUserParticipantIDs.length > 0;

    if (isBonus) {
        let bonusUserMentions = bonusUserParticipantIDs.map((x) =>
            getMention(x)
        );

        if (bonusUserMentions.length > 10) {
            bonusUserMentions = bonusUserMentions.slice(0, 10);
            bonusUserMentions.push(
                LocalizationManager.localizer.translate(
                    guildID,
                    "misc.andManyOthers"
                )
            );
        }

        gameInstructions += `\n\n${bonusUserMentions.join(", ")} `;
        gameInstructions += LocalizationManager.localizer.translate(
            guildID,
            "command.play.exp.doubleExpForVoting",
            {
                link: "https://top.gg/bot/508759831755096074/vote",
            }
        );

        gameInstructions += " ";
        gameInstructions += LocalizationManager.localizer.translate(
            guildID,
            "command.play.exp.howToVote",
            { vote: `\`${process.env.BOT_PREFIX}vote\`` }
        );
    }

    if (isWeekend()) {
        gameInstructions += `\n\n**⬆️ ${LocalizationManager.localizer.translate(
            guildID,
            "command.play.exp.weekend"
        )} ⬆️**`;
    } else if (isPowerHour()) {
        gameInstructions += `\n\n**⬆️ ${LocalizationManager.localizer.translate(
            guildID,
            "command.play.exp.powerHour"
        )} ⬆️**`;
    }

    const startTitle = LocalizationManager.localizer.translate(
        guildID,
        "command.play.gameStarting",
        {
            textChannelName,
            voiceChannelName,
        }
    );

    const gameInfoMessage = await getGameInfoMessage(messageContext.guildID);

    const fields: Eris.EmbedField[] = [];
    if (gameInfoMessage) {
        fields.push({
            name: LocalizationManager.localizer.translate(
                guildID,
                gameInfoMessage.title
            ),
            value: gameInfoMessage.message,
            inline: false,
        });
    }

    const optionsEmbedPayload = await generateOptionsMessage(
        Session.getSession(guildID),
        messageContext,
        guildPreference,
        null
    );

    if (!isBonus && Math.random() < 0.5) {
        optionsEmbedPayload.footerText =
            LocalizationManager.localizer.translate(
                messageContext.guildID,
                "command.play.voteReminder",
                {
                    vote: `${process.env.BOT_PREFIX}vote`,
                }
            );
    }

    await sendInfoMessage(
        messageContext,
        {
            title: startTitle,
            description: gameInstructions,
            color: isBonus ? EMBED_SUCCESS_BONUS_COLOR : null,
            thumbnailUrl: KmqImages.HAPPY,
            fields,
            footerText: State.version,
        },
        false,
        true,
        undefined,
        [generateEmbed(messageContext, optionsEmbedPayload)]
    );
}

export default class PlayCommand implements BaseCommand {
    preRunChecks = [
        { checkFn: CommandPrechecks.competitionPrecheck },
        { checkFn: CommandPrechecks.notListeningPrecheck },
        { checkFn: CommandPrechecks.notRestartingPrecheck },
        { checkFn: CommandPrechecks.maintenancePrecheck },
    ];

    validations = {
        minArgCount: 0,
        maxArgCount: 2,
        arguments: [],
    };

    aliases = ["random", "start", "p"];

    help = (guildID: string): HelpDocumentation => ({
        name: "play",
        description: LocalizationManager.localizer.translate(
            guildID,
            "command.play.help.description"
        ),
        usage: `,play {classic | elimination | teams}\n,play elimination {${LocalizationManager.localizer.translate(
            guildID,
            "command.play.help.usage.lives"
        )}}`,
        priority: 1050,
        examples: [
            {
                example: "`,play`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.play.help.example.classic"
                ),
            },
            {
                example: "`,play elimination 5`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.play.help.example.elimination",
                    {
                        lives: "`5`",
                    }
                ),
            },
            {
                example: "`,play elimination`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.play.help.example.elimination",
                    {
                        lives: `\`${ELIMINATION_DEFAULT_LIVES}\``,
                    }
                ),
            },
            {
                example: "`,play teams`",
                explanation: LocalizationManager.localizer.translate(
                    guildID,
                    "command.play.help.example.teams"
                ),
            },
        ],
    });

    call = async ({
        message,
        parsedMessage,
        channel,
    }: CommandArgs): Promise<void> => {
        const messageContext = MessageContext.fromMessage(message);
        const guildID = message.guildID;
        const guildPreference = await GuildPreference.getGuildPreference(
            guildID
        );

        const voiceChannel = getUserVoiceChannel(messageContext);
        const gameSessions = State.gameSessions;

        const timeUntilRestart = await getTimeUntilRestart();
        if (timeUntilRestart) {
            await sendErrorMessage(messageContext, {
                title: LocalizationManager.localizer.translate(
                    guildID,
                    "command.play.failure.botRestarting.title"
                ),
                description: LocalizationManager.localizer.translate(
                    guildID,
                    "command.play.failure.botRestarting.description",
                    { timeUntilRestart: `\`${timeUntilRestart}\`` }
                ),
            });

            logger.warn(
                `${getDebugLogHeader(
                    message
                )} | Attempted to start game session before restart.`
            );
            return;
        }

        if (!voiceChannel) {
            await sendErrorMessage(messageContext, {
                title: LocalizationManager.localizer.translate(
                    guildID,
                    "misc.failure.notInVC.title"
                ),
                description: LocalizationManager.localizer.translate(
                    guildID,
                    "misc.failure.notInVC.description",
                    { command: `\`${process.env.BOT_PREFIX}play\`` }
                ),
            });

            logger.warn(
                `${getDebugLogHeader(message)} | User not in voice channel`
            );
            return;
        }

        if (!voicePermissionsCheck(message)) {
            return;
        }

        // check for invalid premium game options
        const premiumRequest = await isPremiumRequest(
            gameSessions[guildID],
            message.author.id
        );

        if (!premiumRequest) {
            for (const [commandName, command] of Object.entries(
                State.client.commands
            )) {
                if (command.isUsingPremiumOption) {
                    if (command.isUsingPremiumOption(guildPreference)) {
                        logger.info(
                            `Session started by non-premium request, clearing premium option: ${commandName}`
                        );
                        // eslint-disable-next-line no-await-in-loop
                        await command.resetPremium(guildPreference);
                    }
                }
            }
        }

        const gameType =
            (parsedMessage.components[0]?.toLowerCase() as GameType) ??
            GameType.CLASSIC;

        if (gameSessions[guildID]) {
            if (gameSessions[guildID]?.sessionInitialized) {
                logger.warn(
                    `${getDebugLogHeader(
                        message
                    )} | Attempted to start a game while one is already in progress.`
                );

                await sendErrorMessage(messageContext, {
                    title: LocalizationManager.localizer.translate(
                        guildID,
                        "command.play.failure.alreadyInSession"
                    ),
                });

                return;
            }

            if (
                !gameSessions[guildID].sessionInitialized &&
                gameType === GameType.TEAMS
            ) {
                // User sent ,play teams twice, reset the GameSession
                Session.deleteSession(guildID);
                logger.info(
                    `${getDebugLogHeader(
                        message
                    )} | Teams game session was in progress, has been reset.`
                );
            }
        }

        const prefix = process.env.BOT_PREFIX;

        // (1) No game session exists yet (create ELIMINATION, TEAMS, CLASSIC, or COMPETITION game), or
        // (2) User attempting to ,play after a ,play teams that didn't start, start CLASSIC game
        const textChannel = channel;
        const gameOwner = new KmqMember(message.author.id);
        let gameSession: GameSession;
        const isPremium = await areUsersPremium(
            getCurrentVoiceMembers(voiceChannel.id).map((x) => x.id)
        );

        if (gameType === GameType.TEAMS) {
            // (1) TEAMS game creation
            const startTitle = LocalizationManager.localizer.translate(
                guildID,
                "command.play.team.joinTeam.title",
                {
                    join: `\`${prefix}join\``,
                }
            );

            const gameInstructions = LocalizationManager.localizer.translate(
                guildID,
                "command.play.team.joinTeam.description",
                { join: `${prefix}join` }
            );

            gameSession = new GameSession(
                guildPreference,
                textChannel.id,
                voiceChannel.id,
                textChannel.guild.id,
                gameOwner,
                gameType,
                isPremium
            );

            logger.info(
                `${getDebugLogHeader(message)} | Team game session created.`
            );

            await sendInfoMessage(messageContext, {
                title: startTitle,
                description: gameInstructions,
                thumbnailUrl: KmqImages.HAPPY,
            });
        } else {
            // (1 and 2) CLASSIC, ELIMINATION, and COMPETITION game creation
            if (gameSessions[guildID]) {
                // (2) Let the user know they're starting a non-teams game
                const oldGameType = gameSessions[guildID].gameType;
                const ignoringOldGameTypeTitle =
                    LocalizationManager.localizer.translate(
                        guildID,
                        "command.play.failure.overrideTeams.title",
                        { playOldGameType: `\`${prefix}play ${oldGameType}\`` }
                    );

                const gameSpecificInstructions =
                    LocalizationManager.localizer.translate(
                        guildID,
                        "command.play.failure.overrideTeams.teams.join",
                        {
                            join: `${prefix}join`,
                        }
                    );

                const oldGameTypeInstructions =
                    LocalizationManager.localizer.translate(
                        guildID,
                        "command.play.failure.overrideTeams.description",
                        {
                            oldGameType: `\`${oldGameType}\``,
                            end: `\`${prefix}end\``,
                            playOldGameType: `\`${prefix}play ${oldGameType}\``,
                            gameSpecificInstructions,
                            begin: `\`${prefix}begin\``,
                        }
                    );

                logger.warn(
                    `${getDebugLogHeader(
                        message
                    )} | User attempted ,play on a mode that requires player joins.`
                );

                sendErrorMessage(messageContext, {
                    title: ignoringOldGameTypeTitle,
                    description: oldGameTypeInstructions,
                    thumbnailUrl: KmqImages.DEAD,
                });
            }

            if (gameType === GameType.COMPETITION) {
                const isModerator = await dbContext
                    .kmq("competition_moderators")
                    .select("user_id")
                    .where("guild_id", "=", guildID)
                    .andWhere("user_id", "=", message.author.id)
                    .first();

                if (!isModerator) {
                    sendErrorMessage(messageContext, {
                        title: LocalizationManager.localizer.translate(
                            guildID,
                            "command.play.failure.hiddenGameMode.title"
                        ),
                        description: LocalizationManager.localizer.translate(
                            guildID,
                            "command.play.failure.hiddenGameMode.description"
                        ),
                        thumbnailUrl: KmqImages.DEAD,
                    });
                    return;
                }
            }

            let lives: number;
            if (gameType === GameType.ELIMINATION) {
                lives =
                    parsedMessage.components.length > 1 &&
                    Number.isInteger(
                        parseInt(parsedMessage.components[1], 10)
                    ) &&
                    parseInt(parsedMessage.components[1], 10) > 0 &&
                    parseInt(parsedMessage.components[1], 10) <= 10000
                        ? parseInt(parsedMessage.components[1], 10)
                        : ELIMINATION_DEFAULT_LIVES;
            }

            gameSession = new GameSession(
                guildPreference,
                textChannel.id,
                voiceChannel.id,
                textChannel.guild.id,
                gameOwner,
                gameType,
                isPremium,
                lives
            );
        }

        // prevent any duplicate game sessions
        if (gameSessions[guildID]) {
            await gameSessions[guildID].endSession();
        }

        State.gameSessions[guildID] = gameSession;

        if (gameType !== GameType.TEAMS) {
            await sendBeginGameSessionMessage(
                textChannel.name,
                voiceChannel.name,
                messageContext,
                getCurrentVoiceMembers(voiceChannel.id).map((x) => x.id),
                guildPreference
            );

            await gameSession.startRound(messageContext);
        }
    };
}
