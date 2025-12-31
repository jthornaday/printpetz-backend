export type NonRenewingPurchaseObject = {
  userId: string;
  planId: string;
  store: string;
  transactionId: string;
  priceInUsd: number;
  currency: string;
  priceInCountryCurrency: number;
  expire_at: Date;
  environment: string;
  periodType: string;
};

export interface IPurchase {
  id: number;
  user_id: string;
  transaction_id: string;
  amount: number;
  currency: string;
  credits: number;
}
