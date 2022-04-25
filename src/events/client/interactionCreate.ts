import Eris from "eris";
import _ from "lodash";
import MessageContext from "../../structures/message_context";
import KmqMember from "../../structures/kmq_member";
import {
    getUserTag,
    tryInteractionAcknowledge,
    tryCreateInteractionErrorAcknowledgement,
    sendOptionsMessage,
    tryAutocompleteInteractionAcknowledge,
    getDebugLogHeader,
    tryCreateInteractionSuccessAcknowledgement,
} from "../../helpers/discord_utils";
import { state } from "../../kmq_worker";
import { handleProfileInteraction } from "../../commands/game_commands/profile";
import { IPCLogger } from "../../logger";
import { GameOption, MatchedArtist } from "../../types";
import { getGuildPreference } from "../../helpers/game_utils";

export const BOOKMARK_COMMAND_NAME = "Bookmark Song";
export const PROFILE_COMMAND_NAME = "Profile";

const logger = new IPCLogger("interactionCreate");

/**
 * Handles the 'interactionCreate' event
 * @param interaction - The originating Interaction
 */
export default async function interactionCreateHandler(
    interaction:
        | Eris.PingInteraction
        | Eris.CommandInteraction
        | Eris.ComponentInteraction
        | Eris.AutocompleteInteraction
        | Eris.UnknownInteraction
): Promise<void> {
    if (interaction instanceof Eris.ComponentInteraction) {
        const gameSession = state.gameSessions[interaction.guildID];
        if (!gameSession || !gameSession.round) {
            tryInteractionAcknowledge(interaction);
            return;
        }

        const messageContext = new MessageContext(
            interaction.channel.id,
            new KmqMember(
                interaction.member.username,
                getUserTag(interaction.member),
                interaction.member.avatarURL,
                interaction.member.id
            ),
            interaction.guildID
        );

        gameSession.handleMultipleChoiceInteraction(
            interaction,
            messageContext
        );
    } else if (interaction instanceof Eris.CommandInteraction) {
        if (
            interaction.data.type ===
            Eris.Constants.ApplicationCommandTypes.CHAT_INPUT
        ) {
            const messageContext = new MessageContext(
                interaction.channel.id,
                new KmqMember(
                    interaction.member.username,
                    getUserTag(interaction.member),
                    interaction.member.avatarURL,
                    interaction.member.id
                ),
                interaction.guildID
            );

            logger.info(
                `${getDebugLogHeader(interaction)} | ${
                    interaction.data.name
                } slash command received`
            );

            if (interaction.data.name === "groups") {
                const groups: Array<MatchedArtist> = _.uniqBy(
                    interaction.data.options.map(
                        (x) => JSON.parse(x["value"]) as MatchedArtist
                    ),
                    "id"
                );

                const guildPreference = await getGuildPreference(
                    interaction.guildID
                );

                await guildPreference.setGroups(groups);
                tryCreateInteractionSuccessAcknowledgement(
                    interaction,
                    state.localizer.translate(
                        interaction.guildID,
                        "command.groups.interaction.groupsUpdated.title"
                    ),
                    state.localizer.translate(
                        interaction.guildID,
                        "command.groups.interaction.groupsUpdated.description"
                    )
                );

                await sendOptionsMessage(messageContext, guildPreference, [
                    { option: GameOption.GROUPS, reset: false },
                ]);
            }
        } else if (
            interaction.data.type ===
            Eris.Constants.ApplicationCommandTypes.USER
        ) {
            if (interaction.data.name === PROFILE_COMMAND_NAME) {
                handleProfileInteraction(
                    interaction,
                    interaction.data.target_id
                );
            }
        } else if (
            interaction.data.type ===
            Eris.Constants.ApplicationCommandTypes.MESSAGE
        ) {
            if (interaction.data.name === BOOKMARK_COMMAND_NAME) {
                const gameSession = state.gameSessions[interaction.guildID];
                if (!gameSession) {
                    tryCreateInteractionErrorAcknowledgement(
                        interaction,
                        state.localizer.translate(
                            interaction.guildID,
                            "misc.failure.interaction.bookmarkOutsideGame"
                        )
                    );
                    return;
                }

                gameSession.handleBookmarkInteraction(interaction);
            } else if (interaction.data.name === PROFILE_COMMAND_NAME) {
                const messageId = interaction.data.target_id;
                const authorId =
                    interaction.data.resolved["messages"].get(messageId).author
                        .id;

                handleProfileInteraction(interaction, authorId);
            }
        }
    } else if (interaction instanceof Eris.AutocompleteInteraction) {
        const userInput = interaction.data.options.filter(
            (x) => x["focused"]
        )[0]["value"] as string;

        const artistEntryToInteraction = (
            x: MatchedArtist
        ): { name: string; value: string } => ({
            name: x.name,
            value: JSON.stringify(x),
        });

        if (interaction.data.name === "groups") {
            if (userInput === "") {
                tryAutocompleteInteractionAcknowledge(
                    interaction,
                    state.topArtists.map((x) => artistEntryToInteraction(x))
                );

                return;
            }

            const matchingGroups = Object.entries(state.artistToEntry)
                .filter((x) => !x[0].includes("+"))
                .filter((x) =>
                    x[0].toLowerCase().startsWith(userInput.toLowerCase())
                )
                .slice(0, 25)
                .sort((a, b) =>
                    a[0].toLowerCase() < b[0].toLowerCase()
                        ? -1
                        : a[0].toLowerCase() > b[0].toLowerCase()
                        ? 1
                        : 0
                );

            tryAutocompleteInteractionAcknowledge(
                interaction,
                matchingGroups.map((x) => artistEntryToInteraction(x[1]))
            );
        }
    }
}
