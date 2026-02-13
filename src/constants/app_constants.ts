export default class AppConstants {
  static port = process.env.PORT || 81;
  static isProduction = process.env.NODE_ENV === "production";

  static supabaseUrl = process.env.SUPABASE_URL;
  static supabaseServiceKey = process.env.SUPABASE_KEY;
  static supabaseDbUrl = process.env.SUPABASE_DB_URL;

  static stripeKey = process.env.STRIPE_API_KEY;
  static stripePriceChangeWebhookSecret =
    process.env.STRIPE_PRICE_CHANGE_WEBHOOK_SECRET;
  static stripeCheckoutWebhookSecret =
    process.env.STRIPE_CHECKOUT_WEBHOOK_SECRET;

  static awsAccessKey = process.env.AWS_ACCESS_KEY;
  static awsSecretKey = process.env.AWS_SECRET_KEY;
  static awsBucketName = process.env.AWS_BUCKET;
  static cloudfrontDomain = "https://d155jdfit5sgy.cloudfront.net";

  static falApiKey = process.env.FAL_API_KEY;

  static serverBaseUrl = process.env.SERVER_BASE_URL;

  static modelTrainingCredit = 30;
  static imageGenerationCredit = 2;
}
