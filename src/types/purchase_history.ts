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

interface PriceDetails {
  price: number;
  currency?: string;
}

export interface IPurchaseHistory {
  id: number;
  user_id: string;
  credit: number;
  transfer_id: string;
  price_details: PriceDetails;
}
