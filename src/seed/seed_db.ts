import * as request from "request-promise";
import * as fs from "fs";
import { execSync } from "child_process";
import * as unzipper from "unzipper";
import * as mysql from "promise-mysql";
import * as _config from "../../config/app_config.json";
import * as prependFile from 'prepend-file';
import _logger from "../logger";
import { Logger } from "log4js";
const config: any = _config;
const fileUrl = "http://kpop.aoimirai.net/download.php";
const logger: Logger = _logger("seed_db");

//TODO: this is probably not how you use promises fix later

let options = {
    url: fileUrl,
    encoding: null,
    headers: {
        "Host": "kpop.aoimirai.net",
        "User-Agent": "PostmanRuntime/7.22.0"
    }
}

const databaseDownloadDir = "./kpop_db";

let setSqlMode = (sqlFile) => {
    prependFile.sync(sqlFile, `SET @@sql_mode="";\n`);
}

let main = async function () {
    await fs.promises.mkdir(`${databaseDownloadDir}/sql`, { recursive: true })
    const output = `${databaseDownloadDir}/bootstrap.zip`
    let db = await mysql.createConnection({
        host: "localhost",
        user: config.dbUser,
        password: config.dbPassword
    });

    request(options)
        .then((resp, body) => {
            return new Promise(async (resolve, reject) => {
                try {
                    await fs.promises.writeFile(output, resp);
                    logger.info("Downloaded database.zip");
                    resolve();
                }
                catch (err) {
                    reject(err);
                }
            })
        })
        .then(() => {
            return new Promise((resolve, reject) => {
                fs.createReadStream(`${databaseDownloadDir}/bootstrap.zip`)
                    .pipe(unzipper.Extract({ path: `${databaseDownloadDir}/sql/` }))
                    .on("error", (err) => {
                        // this throws an error even though it finished successfully
                        if (!err.toString().includes("invalid signature")) {
                            reject(err);
                        }
                        logger.info("Extracted database.zip");
                        resolve();
                    })
                    .on("finish", () => resolve())
            })
        })
        .then(async () => {
            return new Promise(async (resolve, reject) => {
                let files = await fs.promises.readdir(`${databaseDownloadDir}/sql`);
                let seedFile = `${databaseDownloadDir}/sql/${files[0]}`;
                logger.info("Dropping K-Pop video database");
                await db.query("DROP DATABASE IF EXISTS kpop_videos;");
                logger.info("Creating K-pop video database")
                await db.query("CREATE DATABASE kpop_videos;");
                logger.info("Seeding K-Pop video database");
                setSqlMode(seedFile);
                execSync(`mysql kpop_videos < ${seedFile}`)
                logger.info(`Imported database dump (${files[0]}) successfully`);
                logger.info("Creating K-pop Music Quiz database");
                await db.query("CREATE DATABASE IF NOT EXISTS kmq");
                //this is awful but idk why it won't end
                process.exit();
            })
        })
        .catch(e => logger.info(e))
};

main()