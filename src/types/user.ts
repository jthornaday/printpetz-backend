export interface IUser {
  id: string;
  name: string | null;
  email: string;
  profile_image: string | null;
  credits: number;
  stripe_customer_id: string | null;
}
