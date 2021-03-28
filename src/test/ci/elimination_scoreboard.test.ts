import assert from "assert";
import EliminationScoreboard from "../../structures/elimination_scoreboard";

const userIDs = ["12345", "23456", "34567"];
const DEFAULT_LIVES = 10;

let scoreboard: EliminationScoreboard;
beforeEach(() => {
    scoreboard = new EliminationScoreboard(DEFAULT_LIVES);
});

describe("score/xp updating", () => {
    beforeEach(() => {
        scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl");
        scoreboard.addPlayer(userIDs[1], "seulgi#7854", "someurl");
        scoreboard.addPlayer(userIDs[2], "joy#4144", "someurl");
    });
    describe("single player scoreboard", () => {
        describe("user guesses correctly multiple times", () => {
            it("should not affect their lives", () => {
                scoreboard.addPlayer(userIDs[0], "yeonwoo#4747", "someurl");
                for (let i = 0; i < 20; i++) {
                    scoreboard.updateScoreboard("yeonwoo#4785", userIDs[0], "someurl", 1, 0);
                    assert.strictEqual(scoreboard.getPlayerLives(userIDs[0]), 10);
                }
            });
        });
    });

    describe("multi player scoreboard", () => {
        describe("one person guesses correctly multiple times", () => {
            it("should decrement every other user's scores", () => {
                for (let i = 0; i < 5; i++) {
                    scoreboard.updateScoreboard("irene#1234", userIDs[0], "someurl", 1, 50);
                }
                assert.strictEqual(scoreboard.getPlayerLives(userIDs[0]), DEFAULT_LIVES);
                assert.strictEqual(scoreboard.getPlayerLives(userIDs[1]), DEFAULT_LIVES - 5);
                assert.strictEqual(scoreboard.getPlayerLives(userIDs[2]), DEFAULT_LIVES - 5);
            });
        });

        describe("each player guesses correctly a different amount of times", () => {
            it("should decrease each player's score by the amount of guesses of every other player", () => {
                scoreboard.updateScoreboard("irene#1234", userIDs[0], "someurl", 1, 50);
                scoreboard.updateScoreboard("irene#1234", userIDs[0], "someurl", 1, 50);
                scoreboard.updateScoreboard("seulgi#7854", userIDs[1], "someurl", 1, 50);
                scoreboard.updateScoreboard("seulgi#7854", userIDs[1], "someurl", 1, 50);
                scoreboard.updateScoreboard("seulgi#7854", userIDs[1], "someurl", 1, 50);
                scoreboard.updateScoreboard("joy#4144", userIDs[2], "someurl", 1, 50);
                assert.strictEqual(scoreboard.getPlayerLives(userIDs[0]), DEFAULT_LIVES - 4);
                assert.strictEqual(scoreboard.getPlayerLives(userIDs[1]), DEFAULT_LIVES - 3);
                assert.strictEqual(scoreboard.getPlayerLives(userIDs[2]), DEFAULT_LIVES - 5);
            });
        });
    });
});

describe("winner detection", () => {
    beforeEach(() => {
        scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl");
        scoreboard.addPlayer(userIDs[1], "seulgi#7854", "someurl");
        scoreboard.addPlayer(userIDs[2], "joy#4144", "someurl");
    });
    describe("nobody has a score yet", () => {
        it("should return an empty array", () => {
            assert.deepStrictEqual(scoreboard.getWinners(), []);
        });
    });

    describe("single player, has guessed at least once", () => {
        const userID = "12345";
        it("should return the single player", () => {
            scoreboard.updateScoreboard("minju#7489", userID, "someurl", 10, 0);
            assert.strictEqual(scoreboard.getWinners().length, 1);
            assert.strictEqual(scoreboard.getWinners()[0].getID(), userID);
        });
    });

    describe("multiple players, has different number of lives", () => {
        it("should return the player with most number of lives", () => {
            scoreboard.updateScoreboard("minju#7489", userIDs[0], "someurl", 1, 0);
            scoreboard.updateScoreboard("minju#7489", userIDs[0], "someurl", 1, 0);
            scoreboard.updateScoreboard("sakura#5478", userIDs[1], "someurl", 1, 0);
            assert.strictEqual(scoreboard.getWinners().length, 1);
            assert.strictEqual(scoreboard.getWinners()[0].getID(), userIDs[0]);
        });
    });

    describe("multiple players, tied score", () => {
        it("should return the two tied players", () => {
            scoreboard.updateScoreboard("minju#7489", userIDs[0], "someurl", 1, 0);
            scoreboard.updateScoreboard("sakura#5478", userIDs[1], "someurl", 1, 0);
            scoreboard.updateScoreboard("sakura#5478", userIDs[1], "someurl", 1, 0);
            scoreboard.updateScoreboard("yuri#4444", userIDs[2], "someurl", 1, 0);
            scoreboard.updateScoreboard("yuri#4444", userIDs[2], "someurl", 1, 0);
            assert.strictEqual(scoreboard.getWinners().length, 2);
            assert.deepStrictEqual(scoreboard.getWinners().map((x) => x.getID()), [userIDs[1], userIDs[2]]);
        });
    });
});

describe("game finished", () => {
    describe("every player is dead", () => {
        it("should return true", () => {
            scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl", 0);
            scoreboard.addPlayer(userIDs[1], "seulgi#7854", "someurl", 0);
            scoreboard.addPlayer(userIDs[2], "joy#4144", "someurl", 0);
            assert.strictEqual(scoreboard.gameFinished(), true);
        });
    });

    describe("one player is left in a multiplayer game", () => {
        it("should return true", () => {
            scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl", 0);
            scoreboard.addPlayer(userIDs[1], "seulgi#7854", "someurl", 0);
            scoreboard.addPlayer(userIDs[2], "joy#4144", "someurl", 5);
            assert.strictEqual(scoreboard.gameFinished(), true);
        });
    });

    describe("one player is left in a single player game", () => {
        it("should return false", () => {
            scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl", 5);
            assert.strictEqual(scoreboard.gameFinished(), false);
        });
    });

    describe("multiple players are still alive", () => {
        it("should return false", () => {
            scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl", 5);
            scoreboard.addPlayer(userIDs[1], "seulgi#7854", "someurl", 8);
            scoreboard.addPlayer(userIDs[2], "joy#4144", "someurl", 2);
            assert.strictEqual(scoreboard.gameFinished(), false);
        });
    });
});

describe("getLivesOfWeakestPlayer", () => {
    describe("one person is the weakest", () => {
        it("should return the weakest person's number of lives", () => {
            scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl", 5);
            scoreboard.addPlayer(userIDs[1], "seulgi#7854", "someurl", 8);
            scoreboard.addPlayer(userIDs[2], "joy#4144", "someurl", 2);
            assert.strictEqual(scoreboard.getLivesOfWeakestPlayer(), 2);
        });
    });
    describe("tie for the weakest", () => {
        it("should return the number of lives", () => {
            scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl", 3);
            scoreboard.addPlayer(userIDs[1], "seulgi#7854", "someurl", 2);
            scoreboard.addPlayer(userIDs[2], "joy#4144", "someurl", 2);
            assert.strictEqual(scoreboard.getLivesOfWeakestPlayer(), 2);
        });
    });
});

describe("starting lives", () => {
    describe("no explicit number of lives set for player", () => {
        it("should default to the scoreboard's default", () => {
            scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl");
            assert.strictEqual(scoreboard.getPlayerLives(userIDs[0]), DEFAULT_LIVES);
        });
    });
    describe("explicit number of lives set for player", () => {
        it("should use the explicitly set number of lives", () => {
            scoreboard.addPlayer(userIDs[0], "irene#1234", "someurl", 17);
            assert.strictEqual(scoreboard.getPlayerLives(userIDs[0]), 17);
        });
    });
});