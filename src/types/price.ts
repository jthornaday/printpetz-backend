export interface IPrice {
  id: number;
  name: string | null;
  description: string | null;
  price_id: string;
  amount: number;
  currency: string;
  credits: number;
  is_test_mode: boolean;
  is_active: boolean;
  is_most_popular: boolean;
}
