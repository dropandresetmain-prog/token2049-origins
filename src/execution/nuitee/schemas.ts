import { z } from 'zod';

/**
 * Permissive response schemas: only fields we consume are declared, extras pass through.
 * Money fields accept number or string (observed both); they are parsed exactly in money.ts.
 */
const Amount = z.union([z.number(), z.string()]);
const Obj = z.looseObject;

const TotalEntry = Obj({ amount: Amount.optional(), currency: z.string().optional() });
const Fee = Obj({
  included: z.boolean().optional(),
  description: z.string().nullish(),
  amount: Amount.optional(),
  currency: z.string().optional(),
});

const CancelInfo = Obj({
  cancelTime: z.string().nullish(),
  amount: Amount.nullish(),
  currency: z.string().nullish(),
  timezone: z.string().nullish(),
});

export const Policies = Obj({
  cancelPolicyInfos: z.array(CancelInfo).nullish(),
  refundableTag: z.string().nullish(),
});

/** One rate = one room/occupancy. Search/prebook give `total` as an array; book/retrieve as an object. */
export const Rate = Obj({
  name: z.string().nullish(),
  boardName: z.string().nullish(),
  retailRate: Obj({
    total: z.union([z.array(TotalEntry), TotalEntry]).optional(),
    taxesAndFees: z.array(Fee).nullish(),
  }).nullish(),
  cancellationPolicies: Policies.nullish(),
});
export type Rate = z.infer<typeof Rate>;

const RoomType = Obj({
  offerId: z.string().nullish(),
  name: z.string().nullish(),
  rates: z.array(Rate).nullish(),
  offerRetailRate: TotalEntry.nullish(),
});
export type RoomType = z.infer<typeof RoomType>;

export const SearchResponse = Obj({
  data: z
    .array(Obj({ hotelId: z.string().nullish(), roomTypes: z.array(RoomType).nullish() }))
    .nullish(),
  hotels: z.array(Obj({ id: z.string().nullish(), name: z.string().nullish() })).nullish(),
});

const Flag = z.union([z.boolean(), z.number(), z.string()]);

export const PrebookResponse = Obj({
  data: Obj({
    prebookId: z.string().nullish(),
    hotelId: z.string().nullish(),
    currency: z.string().nullish(),
    price: Amount.nullish(),
    sellingPriceToUser: Amount.nullish(),
    roomTypes: z.array(RoomType).nullish(),
    priceDifferencePercent: Amount.nullish(),
    cancellationChanged: z.boolean().nullish(),
    boardChanged: z.boolean().nullish(),
  }),
  priceDifferencePercent: Amount.nullish(),
  cancellationChanged: z.boolean().nullish(),
  boardChanged: z.boolean().nullish(),
});

/** Shared by POST /rates/book (data) and GET /bookings/{id} (data). */
export const BookingData = Obj({
  bookingId: z.string().nullish(),
  clientReference: z.string().nullish(),
  status: z.string().nullish(),
  paymentStatus: z.string().nullish(),
  hotelConfirmationCode: z.string().nullish(),
  hotelId: z.string().nullish(),
  hotel: Obj({ hotelId: z.string().nullish() }).nullish(),
  price: Amount.nullish(),
  currency: z.string().nullish(),
  sandbox: Flag.nullish(),
  bookedRooms: z.array(Obj({ rate: Rate.nullish() })).nullish(),
});
export type BookingData = z.infer<typeof BookingData>;

export const BookingResponse = Obj({ data: BookingData, sandbox: Flag.nullish() });

/** GET /bookings list; docs show snake_case in list rows, older recordings camelCase: accept both. */
export const BookingListResponse = Obj({
  data: z.array(
    Obj({
      bookingId: z.union([z.string(), z.number()]).nullish(),
      id: z.union([z.string(), z.number()]).nullish(),
      clientReference: z.string().nullish(),
      client_reference: z.string().nullish(),
    }),
  ),
});

export const CurrenciesResponse = Obj({ data: z.array(z.unknown()) });
