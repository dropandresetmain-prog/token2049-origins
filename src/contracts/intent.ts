import { z } from 'zod';
import { Money } from './money.js';
import { ProviderRoute } from './common.js';

const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'ISO-3166 alpha-2');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const Iata = z.string().regex(/^[A-Z]{3}$/, 'IATA code');

const common = {
  /** Original user budget; supported FX paths check exact payable against it using frozen reference evidence. */
  spendCeiling: Money,
  /** Optional route pin; otherwise the category default route is used. */
  route: ProviderRoute.optional(),
  objective: z.string().max(500).optional(),
};

export const RetailIntent = z
  .object({
    category: z.literal('retail'),
    /** Optional live retail discovery; omitted preserves the controlled catalog path. */
    discovery: z.enum(['live', 'controlled_catalog']).optional(),
    ...common,
    /** Free text search against the supported store catalog, or an opaque product ref from a prior search. */
    query: z.string().min(1).max(200).optional(),
    productRef: z.string().min(1).max(200).optional(),
    quantity: z.number().int().min(1).max(10),
    shipToCountry: CountryCode,
  })
  .strict()
  .refine((v) => v.query || v.productRef, { message: 'query or productRef required' });

export const HotelIntent = z
  .object({
    category: z.literal('hotel'),
    ...common,
    destination: z.union([
      z.object({ cityName: z.string().min(1).max(100), countryCode: CountryCode }).strict(),
      z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          radiusM: z.number().int().min(100).max(50_000),
        })
        .strict(),
      z.object({ hotelIds: z.array(z.string().min(1).max(64)).min(1).max(20) }).strict(),
    ]),
    checkin: IsoDate,
    checkout: IsoDate,
    occupancies: z
      .array(
        z
          .object({
            adults: z.number().int().min(1).max(6),
            childrenAges: z.array(z.number().int().min(0).max(17)).max(4).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(4),
    guestNationality: CountryCode,
  })
  .strict()
  .refine((v) => v.checkout > v.checkin, { message: 'checkout must be after checkin' });

export const FlightIntent = z
  .object({
    category: z.literal('flight'),
    ...common,
    from: Iata,
    to: Iata,
    departDate: IsoDate,
    adults: z.number().int().min(1).max(4),
    children: z.number().int().min(0).max(0).default(0),
    infants: z.number().int().min(0).max(0).default(0),
  })
  .strict()
  .refine((v) => v.from !== v.to, { message: 'from and to must differ' });

export const PurchaseIntent = z.discriminatedUnion('category', [RetailIntent, HotelIntent, FlightIntent]);
export type PurchaseIntent = z.infer<typeof PurchaseIntent>;
export type RetailIntent = z.infer<typeof RetailIntent>;
export type HotelIntent = z.infer<typeof HotelIntent>;
export type FlightIntent = z.infer<typeof FlightIntent>;

/* ---------- Fulfillment details (PII; stored privately, never echoed in public results) ---------- */

const Email = z.email().max(200);
const Name = z.string().min(1).max(60).regex(/^[A-Za-z][A-Za-z '\-]*$/, 'latin letters');

export const RetailFulfillment = z
  .object({
    category: z.literal('retail'),
    email: Email,
    shippingAddress: z
      .object({
        firstName: Name,
        lastName: Name,
        address1: z.string().min(1).max(120),
        address2: z.string().max(120).optional(),
        city: z.string().min(1).max(80),
        province: z.string().max(80).optional(),
        zip: z.string().min(1).max(20),
        countryCode: CountryCode,
        phone: z.string().max(30).optional(),
      })
      .strict(),
  })
  .strict();

export const HotelFulfillment = z
  .object({
    category: z.literal('hotel'),
    holder: z.object({ firstName: Name, lastName: Name, email: Email, phone: z.string().min(5).max(30) }).strict(),
    guests: z
      .array(
        z
          .object({ occupancyNumber: z.number().int().min(1).max(4), firstName: Name, lastName: Name, email: Email })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

export const FlightFulfillment = z
  .object({
    category: z.literal('flight'),
    contact: z
      .object({
        familyName: Name,
        givenName: Name,
        email: Email,
        /** Atlas format `CCCC-NNNNNNNN` */
        mobile: z.string().regex(/^\d{4}-\d{8}$/),
      })
      .strict(),
    passengers: z
      .array(
        z
          .object({
            familyName: Name,
            givenName: Name,
            gender: z.enum(['M', 'F']),
            birthday: IsoDate,
            nationality: CountryCode,
            passengerType: z.literal('adult'),
            document: z
              .object({
                type: z.enum(['passport']),
                number: z.string().min(4).max(20),
                expiry: IsoDate,
                issuingCountry: CountryCode,
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();

export const Fulfillment = z.discriminatedUnion('category', [RetailFulfillment, HotelFulfillment, FlightFulfillment]);
export type Fulfillment = z.infer<typeof Fulfillment>;
export type RetailFulfillment = z.infer<typeof RetailFulfillment>;
export type HotelFulfillment = z.infer<typeof HotelFulfillment>;
export type FlightFulfillment = z.infer<typeof FlightFulfillment>;
