const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const hpp = require("hpp");

const { globalErrorHandler } = require("./src/controller/errorController");
const AuthRouter = require("./src/route/authRouter");
const AppError = require("./utils/app-error");
const ClassRouter = require("./src/route/classRouter");
const lectureRouter = require("./src/route/lectureRouter");
const webhookRouter = require("./src/route/webhookRouter");

const app = express();

// 1) Global Middlewares
// Set security HTTP headers
app.use(helmet());

// Implement CORS
app.use(cors({
  origin: ['http://localhost:5173', 'https://lucturia.com'],
  credentials: true
}));

// Limit requests from same API
const limiter = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  message: 'Too many requests from this IP, please try again in an hour!'
});
app.use('/api', limiter);

// Body parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' }));

app.use((req, res, next) => {
  const sanitize = (obj) => {
    if (obj instanceof Object) {
      for (const key in obj) {
        if (/^\$/.test(key)) {
          delete obj[key];
        } else {
          sanitize(obj[key]);
        }
      }
    }
    return obj;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.query) {
    // In Express 5, req.query is a getter, so we can't reassign it directly or modify it easily if it's immutable.
    // However, the object returned by the getter is usually mutable.
    // Let's try to sanitize the properties of the object returned by req.query
    const query = req.query;
    sanitize(query);
  }
  if (req.params) req.params = sanitize(req.params);

  next();
});

// Prevent parameter pollution
app.use(hpp());

app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  next();
});

app.use("/api/v1/auth", AuthRouter);
app.use("/api/v1/classes", ClassRouter);
app.use("/api/v1/lectures", lectureRouter);
app.use("/", webhookRouter);

// Catch-all for 404

app.use((req, res, next) =>
  next(new AppError(`can't find ${req.originalUrl} on this server`, 404))
);

app.use(globalErrorHandler);

module.exports = app;
