import { addPaymentHistory } from "./payment_history_service";

type NonRenewingPurchaseProps = {
  user_id: string;
  transfer_id: string;
  credit: number;
  price_details: {
    price: number;
    currency?: string;
  };
};

export const nonRenewingPurchaseHandler = async (
  input: NonRenewingPurchaseProps,
) => {
  const { user_id, transfer_id, credit, price_details } = input;

  addPaymentHistory({
    user_id,
    transfer_id,
    credit,
    price_details,
  });
};
