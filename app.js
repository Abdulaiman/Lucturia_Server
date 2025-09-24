const express = require("express");
const cors = require("cors");
const { globalErrorHandler } = require("./src/controller/errorController");
const AuthRouter = require("./src/route/authRouter");
const AppError = require("./utils/app-error");
const ClassRouter = require("./src/route/classRouter");
const lectureRouter = require("./src/route/lectureRouter");

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  next();
});

app.use("/api/v1/auth", AuthRouter);
app.use("/api/v1/classes", ClassRouter);
app.use("/api/v1/lectures", lectureRouter);

// Catch-all for 404

app.use((req, res, next) =>
  next(new AppError(`can't find ${req.originalUrl} on this server`))
);

app.use(globalErrorHandler);

module.exports = app;
