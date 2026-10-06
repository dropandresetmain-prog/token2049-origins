import { z } from 'zod';

/**
 * Wire shapes for the Atlas endpoints this adapter uses. Schemas model only the fields consumed;
 * unknown fields are ignored. Atlas serializes absent values as explicit JSON null, so nearly
 * everything is nullish. Amounts arrive as JSON numbers (or strings); they are converted with
 * exact decimal parsing and never used in floating point arithmetic.
 */

const Amount = z.union([z.number(), z.string()]).nullish();
const Str = z.string().nullish();

/** Provider-level envelope: success is body `status === 0`. `msg` is deliberately not modeled. */
const Envelope = { status: z.number() };

export const Segment = z.object({
  carrier: Str,
  flightNumber: Str,
  depAirport: Str,
  arrAirport: Str,
  /** `YYYYMMDDHHmm`, airport-local wall clock. */
  depTime: Str,
  arrTime: Str,
});

export const Routing = z.object({
  routingIdentifier: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  adultPrice: Amount,
  adultTax: Amount,
  transactionFee: Amount,
  transactionFeeMode: Str,
  transactionFeePerPax: Amount,
  /** Cache lifetime, ISO-8601 UTC in observed sandbox data. */
  expireTime: Str,
  riskSellout: z.boolean().nullish(),
  fromSegments: z.array(Segment).nullish(),
  retSegments: z.array(z.unknown()).nullish(),
});
export type Routing = z.infer<typeof Routing>;

export const SearchBody = z.object({ ...Envelope, routings: z.array(z.unknown()).nullish() });

export const PriceChange = z.object({
  isPriceChange: z.boolean().nullish(),
  newAdultPrice: Amount,
  newAdultTax: Amount,
});

const RequirementField = z.object({ required: z.boolean().nullish(), maxLength: z.union([z.string(), z.number()]).nullish() });

export const VerifyBody = z.object({
  ...Envelope,
  sessionId: Str,
  maxSeats: z.number().nullish(),
  priceChange: PriceChange.nullish(),
  /** group (`passenger`, ...) -> field name -> requirement flags. */
  bookingRequirement: z.record(z.string(), z.record(z.string(), RequirementField.nullable()).nullable()).nullish(),
  routing: Routing.nullish(),
});
export type VerifyBody = z.infer<typeof VerifyBody>;

export const OrderBody = z.object({
  ...Envelope,
  orderNo: Str,
  pnrCode: Str,
  totalPrice: Amount,
  totalTransactionFee: Amount,
  currency: Str,
  /** Ticketing deadline, `yyyy-MM-dd HH:mm:ss` Singapore time. */
  tktLimitTime: Str,
});
export type OrderBody = z.infer<typeof OrderBody>;

export const PayBody = z.object({ ...Envelope, orderNo: Str });
export type PayBody = z.infer<typeof PayBody>;

export const OrderDetailsBody = z.object({
  ...Envelope,
  orderNo: Str,
  /** "0" held/unpaid, "1" paid and ticketing, "2" ticketed, "-3" cancelled. */
  orderStatus: z.union([z.string(), z.number()]).nullish(),
  ticketStatus: z.union([z.string(), z.number()]).nullish(),
  totalPrice: Amount,
  currency: Str,
  payTime: Str,
  tktLimitTime: Str,
  pnrCode: Str,
  /** Count only is used; ticket numbers persist on cancelled orders and never imply ticketing. */
  paxTicketInfos: z.array(z.unknown()).nullish(),
});
export type OrderDetailsBody = z.infer<typeof OrderDetailsBody>;

/** Row of `orderList.do`. Field names per prior sandbox observation; container key is not documented. */
export const OrderListRow = z.object({
  orderNo: Str,
  orderStatus: z.union([z.string(), z.number()]).nullish(),
  depDate: z.union([z.string(), z.number()]).nullish(),
  fromCity: Str,
  toCity: Str,
  orderCreateTimestamp: z.union([z.string(), z.number()]).nullish(),
  contactEmail: Str,
  paxNames: z.union([z.array(z.string()), z.string()]).nullish(),
});
export type OrderListRow = z.infer<typeof OrderListRow>;
