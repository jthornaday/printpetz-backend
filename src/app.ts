import cors from "cors";
import express from "express";
import { IncomingMessage, ServerResponse } from "http";
import morgan from "morgan";

import { HttpStatusCodes } from "@/constants/http_status_code";
import customResponses from "@/middleware/custom_responses";
import fileRoutes from "@/router/file_router";
import generationRoutes from "@/router/generation_router";
import modelRoutes from "@/router/model_router";
import publicRoutes from "@/router/public_router";
import stripeRoutes from "@/router/stripe_routes";
import webhookRoutes from "@/router/webhook_routes";

import { verifyToken } from "./middleware/verify_token";

const app = express();

const setupForStripeWebhooks = {
  // Because Stripe needs the raw body, we compute it but only when hitting the Stripe callback URL.
  verify: function (
    req: IncomingMessage & { originalUrl?: string; rawbody?: string },
    res: ServerResponse,
    buf: Buffer,
  ) {
    const url = req.originalUrl;
    if (url?.startsWith("/webhook/stripe")) {
      req.rawbody = buf.toString();
    }
  },
};

app.use(cors());
app.use(morgan("dev"));
app.use(customResponses);

app.use(express.urlencoded({ extended: true }));
app.use(express.json(setupForStripeWebhooks));

// health check
app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.use("/webhook", webhookRoutes);

// PUBLIC ROUTES START //

app.use("/public", publicRoutes);

// PUBLIC ROUTES END //

app.use(verifyToken);

// PRIVATE ROUTES START //

app.use("/file", fileRoutes);

app.use("/model", modelRoutes);
app.use("/generation", generationRoutes);
app.use("/stripe", stripeRoutes);

// PRIVATE ROUTES END //

app.use("*", function (req, res) {
  res.status(404).json({
    success: false,
    message: "Page not found",
  });
});

app.set("json replacer", function (key: unknown, value: unknown) {
  if (typeof value === "undefined") {
    return null;
  }
  return value;
});

app.use((err, req, res, next) => {
  err.statusCode = err.statusCode || HttpStatusCodes.INTERNAL_SERVER;
  const className = err.constructor.name;

  if (className === "BaseError") {
    res.customErrorResponse({
      statusCode: err.statusCode,
      message: err.message,
    });
  } else {
    if (className === "ZodError") {
      res.validationError({ message: err.errors[0].message });
      return;
    }

    res.serverError({ message: err.message });
  }
});

export default app;
