import { ELIMINATION_DEFAULT_LIVES } from "../constants";
import Player from "./player";
import State from "../state";

export default class EliminationPlayer extends Player {
    static fromUserID(
        userID: string,
        guildID: string,
        score = ELIMINATION_DEFAULT_LIVES,
        firstGameOfDay = false,
        premium = false
    ): EliminationPlayer {
        const user = State.client.users.get(userID);

        return new EliminationPlayer(
            user.id,
            guildID,
            user.avatarURL,
            score,
            firstGameOfDay,
            premium
        );
    }

    /** @returns the number of lives the player has remaining */
    getLives(): number {
        return this.score;
    }

    /** Decreases the amount of lives the player has remaining */
    decrementLives(): void {
        if (this.score > 0) {
            this.score--;
        }
    }

    /** @returns whether the player has ran out of lives */
    isEliminated(): boolean {
        return this.score === 0;
    }

    /** @returns the lives of the player formatted for the scoreboard */
    getDisplayedScore(): string {
        return !this.isEliminated() ? `❤️ x ${this.getLives()}` : "☠️";
    }

    /**
     * @returns whether to include this player in the scoreboard
     */
    // eslint-disable-next-line class-methods-use-this
    shouldIncludeInScoreboard(): boolean {
        return true;
    }
}
