import Scoreboard from "./scoreboard";
import EliminationPlayer from "./elimination_player";
import _logger from "../logger";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const logger = _logger("elimination_scoreboard");

export default class EliminationScoreboard extends Scoreboard {
    /** Mapping of Discord user ID to EliminationPlayer */
    protected players: { [userID: number]: EliminationPlayer };

    /** The amount of lives each player starts with */
    private readonly startingLives: number;

    constructor(lives: number, guildID: string) {
        super(guildID);
        this.startingLives = lives;
    }

    /**
     * Begins tracking a player on the game's scoreboard
     * @param userID - The player's Discord user ID
     * @param tag - The player's Discord tag
     * @param avatarUrl - The player's Discord avatar URL
     */
    addPlayer(userID: string, tag: string, avatarUrl: string) {
        this.players[userID] = new EliminationPlayer(tag, userID, avatarUrl, 0, this.startingLives);
    }

    /** @returns An array of DiscordEmbed fields representing each participant's lives */
    getScoreboardEmbedFields(): Array<{ name: string, value: string, inline: boolean }> {
        return Object.values(this.players)
            .sort((a, b) => b.getLives() - a.getLives())
            .map((x) => {
                const lives = !x.isEliminated() ? `❤️ x ${x.getLives()}` : "☠️";
                return {
                    name: x.getTag(),
                    value: lives,
                    inline: true,
                };
            });
    }

    /**
     * @param _winnerTag - Unused
     * @param winnerID - The Discord ID of the person who guessed correctly
     * @param _avatarURL - Unused
     * @param _pointsEarned - Unused
     */
    updateScoreboard(_winnerTag: string, winnerID: string, _avatarURL: string, _pointsEarned: number) {
        let maxLives = -1;
        for (const player of Object.values(this.players)) {
            if (player.getId() !== winnerID) {
                player.decrementLives();
            }
            if (player.getLives() === maxLives) {
                this.firstPlace.push(player);
            } else if (player.getLives() > maxLives) {
                this.firstPlace = [player];
                maxLives = player.getLives();
            }
        }
    }

    /**
     * @param userID - The Discord user ID of the participant to check
     * @returns whether or not the player has ran out of lives
     */
    isPlayerEliminated(userID: string): boolean {
        return this.players[userID].isEliminated();
    }

    /** Decrements the lives of all current players */
    decrementAllLives() {
        for (const player of Object.values(this.players)) {
            player.decrementLives();
        }
    }

    /**
     * Checks whether the game has finished depending on whether
     * it is a solo or multiplayer game
     */
    async gameFinished(): Promise<boolean> {
        // Game ends if
        // (1) all players are eliminated that round or
        const allEliminated = Object.values(this.players).every((player) => player.isEliminated());

        // (2) there is one player left in a game that started with multiple players
        const oneLeft = Object.values(this.players).length > 1
            && Object.values(this.players).filter((player) => !player.isEliminated()).length === 1;

        return allEliminated || oneLeft;
    }

    /** Whether there are any winners */
    isEmpty(): boolean {
        return this.firstPlace.length === 0;
    }

    /**
     * @param userId - The Discord user ID to check
     * @returns the number of lives the player has remaining
     */
    getPlayerLives(userId: string): number {
        return this.players[userId].getLives();
    }
}