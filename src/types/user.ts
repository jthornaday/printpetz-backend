export interface IUser {
  id: string;
  name: string | null;
  email: string;
  profile_image: string | null;
  /** Paid credits. */
  credits: number;
  /** Free starter credits, spent before paid ones. Images they pay for are watermarked. */
  free_credits?: number;
  stripe_customer_id: string | null;
}
