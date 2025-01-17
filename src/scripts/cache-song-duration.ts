/* eslint-disable no-await-in-loop */
import { IPCLogger } from "../logger";
import { getAudioDurationInSeconds } from "../helpers/utils";
import { getNewConnection } from "../database_context";
import fs from "fs";
import path from "path";
import type { DatabaseContext } from "../database_context";

const logger = new IPCLogger("cache-song-duration");

async function cacheSongDuration(db: DatabaseContext): Promise<void> {
    let files: Array<string>;
    try {
        files = await fs.promises.readdir(process.env.SONG_DOWNLOAD_DIR);
    } catch (err) {
        logger.error(err);
        return;
    }

    let cachedSongs = 0;
    for (const fileName of files) {
        const vlink = fileName.slice(0, -4);
        if (
            !(await db
                .kmq("cached_song_duration")
                .select("*")
                .where("vlink", "=", vlink)
                .first())
        ) {
            // uncached song
            const songDuration = await getAudioDurationInSeconds(
                path.join(process.env.SONG_DOWNLOAD_DIR, fileName)
            );

            await db.kmq("cached_song_duration").insert({
                vlink,
                duration: songDuration,
            });
            cachedSongs++;
            if (cachedSongs % 100 === 0) {
                logger.info(
                    `${cachedSongs} song durations were cached so far.`
                );
            }
        }
    }

    logger.info(`${cachedSongs} song durations were cached.`);
}

(async () => {
    const db = getNewConnection();
    try {
        await cacheSongDuration(db);
    } finally {
        await db.destroy();
    }
})();
