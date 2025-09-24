const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const app = require("./app");

const DB = process?.env?.DATABASE?.replace(
  "<password>",
  process.env.DATABASE_PASSWORD
);

mongoose
  .connect(DB, {
    useNewUrlParser: true,
  })
  .then(() => console.log("database connection successful"));

const port = 8000;

app.listen(port, () => console.log("server connection successful"));
