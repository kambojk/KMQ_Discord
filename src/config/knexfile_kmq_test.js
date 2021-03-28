const resolve = require("path").resolve;
require('dotenv').config({path: resolve(__dirname, "../../.env")});

module.exports = {
  client: 'mysql',
  connection: {
    user: process.env.DB_USER, password: process.env.DB_PASS, database: "kmq_test", host: process.env.DB_HOST, charset: "utf8mb4"
  },
  pool: {
    min: 0,
    max: 10
  },
  migrations: {
    directory: "../../migrations"
  }
}