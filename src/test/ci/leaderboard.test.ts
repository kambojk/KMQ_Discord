import assert from "assert";
import { describe } from "mocha";
import { EmbedGenerator } from "eris-pagination";
import LeaderboardCommand, { LeaderboardType, LeaderboardDuration, ENTRIES_PER_PAGE } from "../../commands/game_commands/leaderboard";
import dbContext from "../../database_context";
import MessageContext from "../../structures/message_context";
import KmqMember from "../../structures/kmq_member";
import GameSession from "../../structures/game_session";
import { GameType } from "../../types";
import { state } from "../../kmq";

const SERVER_ID = "0";
const gameStarter = new KmqMember("jisoo", "jisoo#4747", "url", "123");
const messageContext = new MessageContext("", gameStarter, SERVER_ID, "");

const INITIAL_MONTH = 5;
const INITIAL_DAY = 14;
const INITIAL_HOUR = 6;
const INITIAL_MINUTE = 5;
const INITIAL_SECONDS = 3;
const date = new Date(new Date().getFullYear(), INITIAL_MONTH, INITIAL_DAY, INITIAL_HOUR, INITIAL_MINUTE, INITIAL_SECONDS);
const secondAgo = new Date(new Date(new Date(date).setSeconds(INITIAL_SECONDS - 1)));
const yesterday = new Date(new Date(date).setDate(INITIAL_DAY - 1));
const lastWeek = new Date(new Date(date).setDate(INITIAL_DAY - 7));
const lastMonth = new Date(new Date(date).setMonth(INITIAL_MONTH - 1));

const INITIAL_TOTAL_ENTRIES = ENTRIES_PER_PAGE * 5;

function generatePlayerStats(numberPlayers: number, offset = 0) {
    return [...Array(numberPlayers).keys()].map((i) => ({
        player_id: String(i + offset),
        songs_guessed: i,
        exp: i + 1,
        level: i,
    }));
}

function generatePlayerServers(numberPlayers: number, serverID: string) {
    return [...Array(numberPlayers).keys()].map((i) => ({
        player_id: String(i),
        server_id: serverID,
    }));
}

async function getNumberOfFields(embedGenerators: EmbedGenerator[]): Promise<number> {
    return embedGenerators.reduce(async (prev, curr) => await prev + (await curr()).fields.length, Promise.resolve(0));
}

describe("getLeaderboardEmbeds", () => {
    describe("off by one errors", () => {
        beforeEach(async () => {
            await dbContext.kmq("player_stats").del();
        });

        describe("fits a page perfectly", () => {
            it("should match the number of pages and embeds", async () => {
                const totalEntries = ENTRIES_PER_PAGE;
                await dbContext.kmq("player_stats")
                    .insert(generatePlayerStats(totalEntries));

                const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GLOBAL, LeaderboardDuration.ALL_TIME);
                const fields = await getNumberOfFields(embeds);
                assert.strictEqual(pageCount, Math.ceil(totalEntries / ENTRIES_PER_PAGE));
                assert.strictEqual(fields, totalEntries);
            });
        });

        describe("one full page + 1 field", () => {
            it("should match the number of pages and embeds", async () => {
                const totalEntries = ENTRIES_PER_PAGE + 1;
                await dbContext.kmq("player_stats")
                    .insert(generatePlayerStats(totalEntries));

                const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GLOBAL, LeaderboardDuration.ALL_TIME);
                const fields = await getNumberOfFields(embeds);
                assert.strictEqual(pageCount, Math.ceil(totalEntries / ENTRIES_PER_PAGE));
                assert.strictEqual(fields, totalEntries);
            });
        });

        describe("one field short of a full page", () => {
            it("should match the number of pages and embeds", async () => {
                const totalEntries = ENTRIES_PER_PAGE - 1;
                await dbContext.kmq("player_stats")
                    .insert(generatePlayerStats(totalEntries));

                const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GLOBAL, LeaderboardDuration.ALL_TIME);
                const fields = await getNumberOfFields(embeds);

                assert.strictEqual(pageCount, Math.ceil(totalEntries / ENTRIES_PER_PAGE));
                assert.strictEqual(fields, totalEntries);
            });
        });
    });

    describe("all-time leaderboard", () => {
        describe("global leaderboard", () => {
            beforeEach(async () => {
                await dbContext.kmq("player_stats").del();
            });

            it("should match the number of pages and embeds", async () => {
                await dbContext.kmq("player_stats")
                    .insert(generatePlayerStats(INITIAL_TOTAL_ENTRIES));

                const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GLOBAL, LeaderboardDuration.ALL_TIME);
                const fields = await getNumberOfFields(embeds);

                assert.strictEqual(pageCount, Math.ceil(INITIAL_TOTAL_ENTRIES / ENTRIES_PER_PAGE));
                assert.strictEqual(fields, INITIAL_TOTAL_ENTRIES);
            });
        });

        describe("server leaderboard", () => {
            beforeEach(async () => {
                await dbContext.kmq("player_stats").del();
                await dbContext.kmq("player_servers").del();
            });

            it("should match the number of pages and embeds", async () => {
                const statsRows = [];
                const serversRows = [];

                statsRows.push(...generatePlayerStats(INITIAL_TOTAL_ENTRIES));
                serversRows.push(...generatePlayerServers(INITIAL_TOTAL_ENTRIES, SERVER_ID));

                // invalid -- players outside of server
                statsRows.push(...generatePlayerStats(5, INITIAL_TOTAL_ENTRIES));

                await dbContext.kmq("player_stats")
                    .insert(statsRows);

                await dbContext.kmq("player_servers")
                    .insert(serversRows);

                const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.SERVER, LeaderboardDuration.ALL_TIME);
                const fields = await getNumberOfFields(embeds);

                assert.strictEqual(pageCount, Math.ceil(INITIAL_TOTAL_ENTRIES / ENTRIES_PER_PAGE));
                assert.strictEqual(fields, INITIAL_TOTAL_ENTRIES);
            });
        });

        describe("game leaderboard", () => {
            beforeEach(async () => {
                await dbContext.kmq("player_stats").del();
            });

            it("should match the number of pages and embeds", async () => {
                const gameSession = new GameSession("", "", SERVER_ID, gameStarter, GameType.CLASSIC);
                state.gameSessions = { [SERVER_ID]: gameSession };
                const statsRows = [];

                statsRows.push(...generatePlayerStats(INITIAL_TOTAL_ENTRIES));
                gameSession.participants = new Set([...Array(INITIAL_TOTAL_ENTRIES).keys()].map((i) => String(i)));

                // invalid -- not in game
                statsRows.push(...generatePlayerStats(5, INITIAL_TOTAL_ENTRIES));

                await dbContext.kmq("player_stats")
                    .insert(statsRows);

                const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GAME, LeaderboardDuration.ALL_TIME);
                const fields = await getNumberOfFields(embeds);

                assert.strictEqual(pageCount, Math.ceil(INITIAL_TOTAL_ENTRIES / ENTRIES_PER_PAGE));
                assert.strictEqual(fields, INITIAL_TOTAL_ENTRIES);
            });
        });
    });

    describe("temporary leaderboard", () => {
        beforeEach(async () => {
            await dbContext.kmq("player_game_session_stats").del();

            const rows = [{
                player_id: "0",
                date,
                songs_guessed: 1,
                exp_gained: 1,
                levels_gained: 1,
            }, {
                player_id: "0",
                date: secondAgo,
                songs_guessed: 1,
                exp_gained: 1,
                levels_gained: 1,
            }, {
                player_id: "1",
                date: secondAgo,
                songs_guessed: 1,
                exp_gained: 1,
                levels_gained: 1,
            },
            {
                player_id: "2",
                date: yesterday,
                songs_guessed: 1,
                exp_gained: 1,
                levels_gained: 1,
            },
            {
                player_id: "3",
                date: lastWeek,
                songs_guessed: 1,
                exp_gained: 1,
                levels_gained: 1,
            },
            {
                player_id: "4",
                date: lastMonth,
                songs_guessed: 1,
                exp_gained: 1,
                levels_gained: 1,
            }];

            for (let i = 5; i < INITIAL_TOTAL_ENTRIES; i++) {
                rows.push({
                    player_id: String(i),
                    date,
                    songs_guessed: 1,
                    exp_gained: 1,
                    levels_gained: 1,
                });
            }

            await dbContext.kmq("player_game_session_stats")
                .insert(rows);
        });

        describe("global leaderboard", () => {
            describe("daily leaderboard", () => {
                it("should match the number of pages and embeds", async () => {
                    // Ignoring entry yesterday
                    // Ignoring entry last week
                    // Ignoring entry last month
                    const validEntryCount = INITIAL_TOTAL_ENTRIES - 3;
                    const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GLOBAL, LeaderboardDuration.DAILY, date);
                    const fields = await getNumberOfFields(embeds);
                    assert.strictEqual(pageCount, Math.ceil(validEntryCount / ENTRIES_PER_PAGE));
                    assert.strictEqual(fields, validEntryCount);
                });
            });

            describe("weekly leaderboard", () => {
                it("should match the number of pages and embeds", async () => {
                    // Ignoring entry last week
                    // Ignoring entry last month
                    const validEntryCount = INITIAL_TOTAL_ENTRIES - 2;
                    const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GLOBAL, LeaderboardDuration.WEEKLY, date);
                    const fields = await getNumberOfFields(embeds);

                    assert.strictEqual(pageCount, Math.ceil(validEntryCount / ENTRIES_PER_PAGE));
                    assert.strictEqual(fields, validEntryCount);
                });
            });

            describe("monthly leaderboard", () => {
                it("should match the number of pages and embeds", async () => {
                    // Ignoring last month
                    const validEntryCount = INITIAL_TOTAL_ENTRIES - 1;
                    const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GLOBAL, LeaderboardDuration.MONTHLY, date);
                    const fields = await getNumberOfFields(embeds);

                    assert.strictEqual(pageCount, Math.ceil(validEntryCount / ENTRIES_PER_PAGE));
                    assert.strictEqual(fields, validEntryCount);
                });
            });
        });

        describe("server leaderboard", () => {
            beforeEach(async () => {
                await dbContext.kmq("player_servers").del();

                const serversRows = [];
                // Player with id 0 is outside server
                for (let i = 1; i <= INITIAL_TOTAL_ENTRIES; i++) {
                    serversRows.push({
                        player_id: String(i),
                        server_id: SERVER_ID,
                    });
                }

                await dbContext.kmq("player_servers")
                    .insert(serversRows);
            });

            describe("daily leaderboard", () => {
                it("should match the number of pages and embeds", async () => {
                    // Ignoring entry of player outside server
                    // Ignoring entry yesterday
                    // Ignoring entry last week
                    // Ignoring entry last month
                    const validEntryCount = INITIAL_TOTAL_ENTRIES - 4;
                    const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.SERVER, LeaderboardDuration.DAILY, date);
                    const fields = await getNumberOfFields(embeds);

                    assert.strictEqual(pageCount, Math.ceil(validEntryCount / ENTRIES_PER_PAGE));
                    assert.strictEqual(fields, validEntryCount);
                });
            });

            describe("weekly leaderboard", () => {
                it("should match the number of pages and embeds", async () => {
                    // Ignoring entry of player outside server
                    // Ignoring entry last week
                    // Ignoring entry last month
                    const validEntryCount = INITIAL_TOTAL_ENTRIES - 3;
                    const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.SERVER, LeaderboardDuration.WEEKLY, date);
                    const fields = await getNumberOfFields(embeds);

                    assert.strictEqual(pageCount, Math.ceil(validEntryCount / ENTRIES_PER_PAGE));
                    assert.strictEqual(fields, validEntryCount);
                });
            });

            describe("monthly leaderboard", () => {
                it("should match the number of pages and embeds", async () => {
                    // Ignoring entry of player outside server
                    // Ignoring entry last month
                    const validEntryCount = INITIAL_TOTAL_ENTRIES - 2;
                    const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.SERVER, LeaderboardDuration.MONTHLY, date);
                    const fields = await getNumberOfFields(embeds);

                    assert.strictEqual(pageCount, Math.ceil(validEntryCount / ENTRIES_PER_PAGE));
                    assert.strictEqual(fields, validEntryCount);
                });
            });
        });

        describe("game leaderboard", () => {
            beforeEach(async () => {
                const gameSession = new GameSession("", "", SERVER_ID, gameStarter, GameType.CLASSIC);
                state.gameSessions = { [SERVER_ID]: gameSession };

                // Player with id 0 is not in game
                for (let i = 1; i < INITIAL_TOTAL_ENTRIES; i++) {
                    gameSession.participants.add(String(i));
                }
            });

            describe("daily leaderboard", () => {
                it("should match the number of pages and embeds", async () => {
                    // Ignoring entry of player outside game
                    // Ignoring entry yesterday
                    // Ignoring entry last week
                    // Ignoring entry last month
                    const validEntryCount = INITIAL_TOTAL_ENTRIES - 4;
                    const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GAME, LeaderboardDuration.DAILY, date);
                    const fields = await getNumberOfFields(embeds);

                    assert.strictEqual(pageCount, Math.ceil(validEntryCount / ENTRIES_PER_PAGE));
                    assert.strictEqual(fields, validEntryCount);
                });
            });

            describe("weekly leaderboard", () => {
                it("should match the number of pages and embeds", async () => {
                    // Ignoring entry of player outside game
                    // Ignoring entry last week
                    // Ignoring entry last month
                    const validEntryCount = INITIAL_TOTAL_ENTRIES - 3;
                    const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GAME, LeaderboardDuration.WEEKLY, date);
                    const fields = await getNumberOfFields(embeds);

                    assert.strictEqual(pageCount, Math.ceil(validEntryCount / ENTRIES_PER_PAGE));
                    assert.strictEqual(fields, validEntryCount);
                });
            });

            describe("monthly leaderboard", () => {
                it("should match the number of pages and embeds", async () => {
                    // Ignoring entry of player outside game
                    // Ignoring entry last month
                    const validEntryCount = INITIAL_TOTAL_ENTRIES - 2;
                    const { embeds, pageCount } = await LeaderboardCommand.getLeaderboardEmbeds(messageContext, LeaderboardType.GAME, LeaderboardDuration.MONTHLY, date);
                    const fields = await getNumberOfFields(embeds);

                    assert.strictEqual(pageCount, Math.ceil(validEntryCount / ENTRIES_PER_PAGE));
                    assert.strictEqual(fields, validEntryCount);
                });
            });
        });
    });
});