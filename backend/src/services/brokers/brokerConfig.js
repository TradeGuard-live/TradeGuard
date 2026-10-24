/**
 * brokerConfig.js
 * 
 * Audited and verified broker pricing and statutory tariff configuration.
 * Official references:
 * - Upstox: https://upstox.com/brokerage-charges/
 * - Dhan: https://dhan.co/pricing/
 * - Angel One: https://www.angelone.in/exchange-transaction-charges
 * - Kotak Neo Trade Free Youth: https://www.kotakneo.com/pricing/trade-free-youth/
 * - Kotak Neo Trade Free: https://www.kotakneo.com/pricing/trade-free-plan/
 */

const brokerConfig = {
    // COMMON EXCHANGE CHARGES (NSE unified circular rates + IPFT)
    exchangeCharges: {
        NSE: {
            equityDelivery: {
                rate: 0.00297, // 0.00297% turnover
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityIntraday: {
                rate: 0.00297,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityFutures: {
                rate: 0.00173, // 0.00173% turnover
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityOptions: {
                rate: 0.03503, // 0.03503% of premium turnover
                unit: "PERCENT",
                basis: "PREMIUM"
            },
            currencyFutures: {
                rate: 0.0009,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            currencyOptions: {
                rate: 0.035,
                unit: "PERCENT",
                basis: "PREMIUM"
            }
        },
        BSE: {
            equityDelivery: {
                rate: 0.00375,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityIntraday: {
                rate: 0.00375,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityFutures: {
                rate: 0,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityOptions: {
                rate: 0.0325,
                unit: "PERCENT",
                basis: "PREMIUM"
            }
        },
        MCX: {
            commodityFutures: {
                rate: 0.0021, // 0.0021% turnover
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            commodityOptions: {
                rate: 0.0418, // 0.0418% premium turnover
                unit: "PERCENT",
                basis: "PREMIUM"
            }
        }
    },

    // STATUTORY / REGULATORY CHARGES (Finance Act 2024 / SEBI norms)
    statutoryCharges: {
        GST: {
            rate: 18,
            unit: "PERCENT",
            appliesTo: ["BROKERAGE", "EXCHANGE_CHARGES", "SEBI_CHARGES"]
        },
        SEBI: {
            ratePerCrore: 10, // ₹10 per crore
            rate: 0.0001,
            unit: "PERCENT",
            basis: "TURNOVER"
        },
        // Securities Transaction Tax (STT) post-Finance Act 2024 (effective Oct 1, 2024)
        STT: {
            equityDelivery: {
                buy: 0.10, // 0.1% on buy turnover
                sell: 0.10, // 0.1% on sell turnover
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityIntraday: {
                buy: 0,
                sell: 0.025, // 0.025% on sell turnover
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityFutures: {
                buy: 0,
                sell: 0.02, // 0.02% on sell turnover (raised from 0.0125% Oct 1, 2024)
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityOptions: {
                buy: 0,
                sell: 0.10, // 0.1% on sell premium (raised from 0.0625% Oct 1, 2024)
                unit: "PERCENT",
                basis: "PREMIUM"
            },
            commodityFutures: {
                buy: 0,
                sell: 0.01, // 0.01% on sell turnover (non-agri)
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            commodityOptions: {
                buy: 0,
                sell: 0.05, // 0.05% on sell premium
                unit: "PERCENT",
                basis: "PREMIUM"
            },
            currencyFutures: {
                buy: 0,
                sell: 0, // No STT on currency derivatives
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            currencyOptions: {
                buy: 0,
                sell: 0,
                unit: "PERCENT",
                basis: "PREMIUM"
            }
        },
        // Stamp Duty (Charged on BUY turnover only)
        stampDuty: {
            equityDelivery: {
                buy: 0.015, // 0.015%
                sell: 0,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityIntraday: {
                buy: 0.003, // 0.003%
                sell: 0,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityFutures: {
                buy: 0.002, // 0.002%
                sell: 0,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            equityOptions: {
                buy: 0.003, // 0.003% on premium
                sell: 0,
                unit: "PERCENT",
                basis: "PREMIUM"
            },
            commodityFutures: {
                buy: 0.002, // 0.002%
                sell: 0,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            commodityOptions: {
                buy: 0.003, // 0.003% on premium
                sell: 0,
                unit: "PERCENT",
                basis: "PREMIUM"
            },
            currencyFutures: {
                buy: 0.0001, // 0.0001%
                sell: 0,
                unit: "PERCENT",
                basis: "TURNOVER"
            },
            currencyOptions: {
                buy: 0.0001,
                sell: 0,
                unit: "PERCENT",
                basis: "PREMIUM"
            }
        }
    },

    // BROKER AUDITED CONFIGURATIONS
    brokers: {
        // UPSTOX
        UPSTOX: {
            id: "UPSTOX",
            name: "Upstox",
            defaultPlan: "STANDARD",
            accountOpening: {
                fee: 0,
                display: "₹0 to ₹249",
                details: "Free during standard online onboarding campaigns; official tariff notes a processing fee up to ₹249 may apply."
            },
            amc: {
                firstYearWaiver: true,
                firstYearFee: 0,
                subsequentFee: 300,
                billingFrequency: "ANNUAL",
                display: "1st Year Free, then ₹300/yr + GST",
                bsdaEligible: true,
                bsdaConditions: "₹0 AMC if holding value < ₹4 Lakhs under SEBI BSDA norms.",
                details: "First year AMC is waived (₹0). From 2nd year onwards, standard non-BSDA Demat AMC is ₹300 + 18% GST per year (~₹25/month). Zero AMC applies if eligible under SEBI BSDA (holdings under ₹4L)."
            },
            plans: {
                STANDARD: {
                    name: "Standard",
                    brokerage: {
                        equityDelivery: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        equityIntraday: {
                            type: "LOWER_OF",
                            flat: 20,
                            percentage: 0.10, // 0.1% of turnover
                            basis: "TURNOVER",
                            display: "Lower of ₹20 or 0.1% of order turnover"
                        },
                        equityFutures: {
                            type: "LOWER_OF",
                            flat: 20,
                            percentage: 0.05, // 0.05% of turnover
                            basis: "TURNOVER",
                            display: "Lower of ₹20 or 0.05% of order turnover"
                        },
                        equityOptions: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        commodityFutures: {
                            type: "LOWER_OF",
                            flat: 20,
                            percentage: 0.05,
                            basis: "TURNOVER",
                            display: "Lower of ₹20 or 0.05% of order turnover"
                        },
                        commodityOptions: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        currencyFutures: {
                            type: "LOWER_OF",
                            flat: 20,
                            percentage: 0.05,
                            basis: "TURNOVER",
                            display: "Lower of ₹20 or 0.05% of order turnover"
                        },
                        currencyOptions: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        }
                    },
                    dpCharges: {
                        sell: 20.0,
                        gstApplicable: true,
                        unit: "PER_SCRIP_PER_DAY",
                        display: "₹20 + 18% GST per scrip on delivery sell"
                    },
                    otherCharges: {
                        autoSquareOff: 50,
                        callAndTrade: 50,
                        apiSubscription: 0
                    }
                }
            },
            displayValues: {
                delivery: "Fixed ₹20/order",
                intraday: "Lower of ₹20 or 0.1%",
                futures: "Lower of ₹20 or 0.05%",
                options: "Fixed ₹20/order",
                commodities: "Lower of ₹20 or 0.05% (Fut) / Fixed ₹20 (Opt)",
                currency: "Lower of ₹20 or 0.05% (Fut) / Fixed ₹20 (Opt)",
                amc: "1st Year Free, then ₹300/yr + GST (BSDA eligible)",
                accountOpening: "₹0 to ₹249 (Campaign dependent)",
                dpCharges: "₹20 + GST per scrip (on sell)",
                autoSquareOff: "₹50 + GST",
                callAndTrade: "₹50 + GST per order",
                apiCharges: "Free (Upstox API v2)"
            },
            segments: "Equity, F&O, Commodity, Currency",
            highlights: [
                "Fixed ₹20 per executed order on Equity Delivery",
                "Lower of ₹20 or 0.1% on Equity Intraday",
                "1st Year Free AMC with SEBI BSDA exemption up to ₹4L",
                "Free modern Developer API v2"
            ]
        },

        // DHAN
        DHAN: {
            id: "DHAN",
            name: "Dhan",
            defaultPlan: "STANDARD",
            accountOpening: {
                fee: 0,
                display: "₹0 (Free)",
                details: "100% Free online Demat & Trading account opening for eligible Individual & HUF accounts."
            },
            amc: {
                firstYearWaiver: true,
                firstYearFee: 0,
                subsequentFee: 0,
                billingFrequency: "LIFETIME_FREE",
                display: "₹0 (Lifetime Free)",
                bsdaEligible: true,
                details: "100% Zero AMC for Life for all individual/HUF accounts unconditionally. No minimum balance conditions, no transaction thresholds, no recurring Demat fees."
            },
            plans: {
                STANDARD: {
                    name: "Standard",
                    brokerage: {
                        equityDelivery: {
                            type: "FLAT",
                            amount: 0,
                            basis: "PER_ORDER",
                            display: "₹0 Brokerage (Free for Life)"
                        },
                        equityIntraday: {
                            type: "LOWER_OF",
                            flat: 20,
                            percentage: 0.03, // 0.03%
                            basis: "TURNOVER",
                            display: "Lower of ₹20 or 0.03% of order turnover"
                        },
                        equityMTF: {
                            type: "LOWER_OF",
                            flat: 20,
                            percentage: 0.03,
                            basis: "TURNOVER",
                            display: "Lower of ₹20 or 0.03% of order turnover"
                        },
                        equityFutures: {
                            type: "FLAT",
                            amount: 20, // FIXED ₹20 per executed order
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        equityOptions: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        commodityFutures: {
                            type: "FLAT",
                            amount: 20, // FIXED ₹20 per executed order
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        commodityOptions: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        currencyFutures: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order (Subject to regulatory exposure)"
                        },
                        currencyOptions: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order (Subject to regulatory exposure)"
                        },
                        // Physical delivery surcharge on derivative contracts
                        derivativePhysicalDelivery: {
                            type: "PERCENTAGE",
                            percentage: 0.10, // 0.10% of physical contract value
                            basis: "CONTRACT_VALUE",
                            display: "0.10% of contract value for physical delivery settlement"
                        }
                    },
                    dpCharges: {
                        sell: 12.50,
                        sellWomen: 10.50,
                        gstApplicable: true,
                        unit: "PER_ISIN",
                        display: "₹12.50 + 18% GST per scrip (₹10.50 + GST for women)"
                    },
                    otherCharges: {
                        autoSquareOff: 20,
                        callAndTrade: 50,
                        apiSubscription: 0
                    }
                }
            },
            displayValues: {
                delivery: "₹0 Brokerage (Free for Life)",
                intraday: "Lower of ₹20 or 0.03%",
                futures: "Fixed ₹20/order",
                options: "Fixed ₹20/order",
                commodities: "Fixed ₹20/order (Futures & Options)",
                currency: "Fixed ₹20/order (Subject to forex exposure confirmation)",
                amc: "₹0 (Lifetime Free for Individuals)",
                accountOpening: "₹0 (Free)",
                dpCharges: "₹12.50 + GST (₹10.50 for women)",
                autoSquareOff: "₹20 + GST",
                callAndTrade: "₹50 + GST per order",
                apiCharges: "Free (Unlimited DhanHQ APIs)"
            },
            segments: "Equity, F&O, Commodity, Currency",
            highlights: [
                "Zero Brokerage on Equity Delivery for life",
                "Fixed ₹20 per executed order on Futures & Options",
                "0.10% brokerage rule for derivative physical delivery settlement",
                "100% Zero AMC for Life for eligible individuals and HUFs",
                "Industry-lowest DP charges (₹12.50 + GST / ₹10.50 for women)"
            ]
        },

        // ANGEL ONE
        ANGEL_ONE: {
            id: "ANGEL_ONE",
            name: "Angel One",
            defaultPlan: "STANDARD",
            accountOpening: {
                fee: 0,
                display: "₹0 (Free)",
                details: "100% Free online paperless account opening."
            },
            amc: {
                firstYearWaiver: true,
                firstYearFee: 0,
                subsequentFee: 240,
                billingFrequency: "QUARTERLY",
                display: "1st Year Free, then ₹60/quarter + GST (₹240/yr)",
                bsdaEligible: true,
                bsdaConditions: "₹0 AMC if holding value < ₹4 Lakhs under SEBI BSDA norms.",
                details: "First year AMC is 100% Free. From 2nd year onwards, standard published non-BSDA tariff is ₹60 + 18% GST per quarter (₹240 + GST = ₹283.20/yr total). Eligible for ₹0 AMC under SEBI BSDA if holdings are under ₹4L."
            },
            promotionalOffer: {
                hasIntroductoryWaiver: true,
                durationDays: 30,
                maxWaiverCap: 500, // Capped at ₹500 discount
                display: "Up to ₹500 of brokerage waived during first 30 days after onboarding (capped discount, not unlimited)"
            },
            plans: {
                STANDARD: {
                    name: "iTrade Prime",
                    brokerage: {
                        equityDelivery: {
                            type: "LOWER_OF",
                            flat: 20,
                            percentage: 0.10, // 0.1% after offer
                            minimum: 5, // Minimum ₹5
                            basis: "TURNOVER",
                            display: "Lower of ₹20 or 0.1% (Min ₹5/order)"
                        },
                        equityIntraday: {
                            type: "LOWER_OF",
                            flat: 20,
                            percentage: 0.10, // 0.1% after offer
                            minimum: 5, // Minimum ₹5
                            basis: "TURNOVER",
                            display: "Lower of ₹20 or 0.1% (Min ₹5/order)"
                        },
                        equityFutures: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        equityOptions: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        commodityFutures: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        commodityOptions: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        currencyFutures: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        },
                        currencyOptions: {
                            type: "FLAT",
                            amount: 20,
                            basis: "PER_ORDER",
                            display: "Fixed ₹20 per executed order"
                        }
                    },
                    dpCharges: {
                        sell: 20.0,
                        cdslShare: 3.50,
                        brokerShare: 16.50,
                        gstApplicable: true,
                        unit: "PER_ISIN",
                        display: "₹20 + 18% GST per ISIN on sell (₹3.50 CDSL + ₹16.50 Angel One)"
                    },
                    otherCharges: {
                        autoSquareOff: 20,
                        callAndTrade: 20,
                        apiSubscription: 0
                    }
                }
            },
            displayValues: {
                delivery: "Lower of ₹20 or 0.1% (Min ₹5)",
                intraday: "Lower of ₹20 or 0.1% (Min ₹5)",
                futures: "Fixed ₹20/order",
                options: "Fixed ₹20/order",
                commodities: "Fixed ₹20/order (Futures & Options)",
                currency: "Fixed ₹20/order (Futures & Options)",
                amc: "1st Year Free, then ₹60/quarter + GST (₹240/yr)",
                accountOpening: "₹0 (Free)",
                dpCharges: "₹20 + GST per ISIN (₹3.50 CDSL + ₹16.50 broker)",
                autoSquareOff: "₹20 + GST",
                callAndTrade: "₹20 + GST per order",
                apiCharges: "Free (SmartAPI)"
            },
            segments: "Equity, F&O, Commodity, Currency",
            highlights: [
                "Up to ₹500 brokerage waiver capped discount during first 30 days",
                "Equity Delivery & Intraday: Lower of ₹20 or 0.1% (Min ₹5)",
                "Futures & Options: Fixed ₹20 per executed order",
                "1st Year 100% Free AMC (then ₹60/quarter + GST)",
                "DP charges: ₹20 + GST per ISIN (published CDSL + broker breakdown)"
            ]
        },

        // KOTAK NEO (Multi-plan configuration)
        KOTAK_NEO: {
            id: "KOTAK_NEO",
            name: "Kotak Neo",
            defaultPlan: "TRADE_FREE",
            plans: {
                YOUTH: {
                    id: "KOTAK_NEO_YOUTH",
                    name: "Trade Free Youth",
                    eligibility: "Investors & Traders under 30 years of age",
                    accountOpening: {
                        fee: 99,
                        display: "₹99 one-time",
                        details: "₹99 one-time account opening subscription for users under 30 years."
                    },
                    amc: {
                        firstYearWaiver: true,
                        firstYearFee: 0,
                        subsequentFee: 299,
                        billingFrequency: "ANNUAL",
                        display: "1st Year Free, then ₹299/yr + GST",
                        bsdaEligible: true,
                        details: "1st Year AMC is 100% Free. Starting 2nd year onwards: ₹299 + 18% GST/year. Free under SEBI BSDA if holdings are under ₹4 Lakhs."
                    },
                    promotionalOffer: {
                        hasIntroductoryWaiver: true,
                        durationDays: 30,
                        display: "Equity Intraday & F&O ₹0 brokerage for first 30 days"
                    },
                    brokerage: {
                        equityDelivery: {
                            type: "FLAT",
                            amount: 0,
                            basis: "PER_ORDER",
                            display: "₹0 Brokerage (Free for Life)"
                        },
                        equityIntraday: {
                            type: "LOWER_OF",
                            flat: 10,
                            percentage: 0.05, // 0.05%
                            first30Days: 0, // ₹0 for first 30 days
                            basis: "TURNOVER",
                            display: "₹0 for 1st 30 days, then lower of ₹10 or 0.05%"
                        },
                        equityFutures: {
                            type: "FLAT",
                            amount: 10,
                            first30Days: 0, // ₹0 for first 30 days
                            basis: "PER_ORDER",
                            display: "₹0 for 1st 30 days, then Fixed ₹10/order"
                        },
                        equityOptions: {
                            type: "FLAT",
                            amount: 10,
                            first30Days: 0, // ₹0 for first 30 days
                            basis: "PER_ORDER",
                            display: "₹0 for 1st 30 days, then Fixed ₹10/order"
                        },
                        commodityFutures: {
                            type: "FLAT",
                            amount: 10,
                            basis: "PER_ORDER",
                            display: "Fixed ₹10 per executed order"
                        },
                        commodityOptions: {
                            type: "FLAT",
                            amount: 10,
                            basis: "PER_ORDER",
                            display: "Fixed ₹10 per executed order"
                        },
                        currencyFutures: {
                            type: "FLAT",
                            amount: 10,
                            basis: "PER_ORDER",
                            display: "Fixed ₹10 per executed order"
                        },
                        currencyOptions: {
                            type: "FLAT",
                            amount: 10,
                            basis: "PER_ORDER",
                            display: "Fixed ₹10 per executed order"
                        }
                    },
                    dpCharges: {
                        sell: 15.0,
                        gstApplicable: true,
                        unit: "PER_ISIN",
                        display: "₹15 + 18% GST per ISIN on sell"
                    },
                    otherCharges: {
                        autoSquareOff: 50,
                        callAndTrade: 50,
                        apiSubscription: 0
                    },
                    displayValues: {
                        delivery: "₹0 Brokerage (Free for Life)",
                        intraday: "₹0 for 1st 30 days, then ₹10 or 0.05%",
                        futures: "₹0 for 1st 30 days, then Fixed ₹10/order",
                        options: "₹0 for 1st 30 days, then Fixed ₹10/order",
                        commodities: "Fixed ₹10/order",
                        currency: "Fixed ₹10/order",
                        amc: "1st Year Free, then ₹299/yr + GST",
                        accountOpening: "₹99 one-time",
                        dpCharges: "₹15 + GST per ISIN",
                        autoSquareOff: "₹50 + GST",
                        callAndTrade: "₹50 + GST per order",
                        apiCharges: "Free (Kotak Neo Trade API)"
                    },
                    highlights: [
                        "Exclusively for traders & investors under 30 years of age",
                        "Equity Delivery: ₹0 Brokerage for life",
                        "Equity Intraday & F&O: ₹0 for first 30 days, then Fixed ₹10/order",
                        "1st Year Free AMC (then ₹299/yr + GST)"
                    ]
                },
                TRADE_FREE: {
                    id: "KOTAK_NEO_TRADE_FREE",
                    name: "Trade Free Plan",
                    eligibility: "Standard plan (All investors & 30+ yrs)",
                    accountOpening: {
                        fee: 0,
                        display: "₹0 (Free)",
                        details: "100% Free online Demat & Trading account opening."
                    },
                    amc: {
                        firstYearWaiver: true,
                        firstYearFee: 0,
                        subsequentFee: 600,
                        billingFrequency: "MONTHLY",
                        display: "1st Year Free, then ₹50/mo + GST (₹600/yr)",
                        bsdaEligible: true,
                        details: "1st Year AMC is 100% Free. Starting 2nd year onwards: ₹50/month + 18% GST (₹600 + GST/year). Free under SEBI BSDA if holdings are under ₹4 Lakhs."
                    },
                    promotionalOffer: {
                        hasIntroductoryWaiver: true,
                        durationDays: 30,
                        display: "Delivery, Intraday & F&O ₹0 brokerage for first 30 days"
                    },
                    brokerage: {
                        equityDelivery: {
                            type: "PERCENTAGE",
                            percentage: 0.20, // 0.20% after first 30 days
                            first30Days: 0, // ₹0 for first 30 days
                            basis: "TURNOVER",
                            display: "₹0 for 1st 30 days, then 0.20% of trade value"
                        },
                        equityIntraday: {
                            type: "LOWER_OF",
                            flat: 10,
                            percentage: 0.05,
                            first30Days: 0, // ₹0 for first 30 days
                            basis: "TURNOVER",
                            display: "₹0 for 1st 30 days, then lower of ₹10 or 0.05%"
                        },
                        equityFutures: {
                            type: "FLAT",
                            amount: 10,
                            first30Days: 0, // ₹0 for first 30 days
                            basis: "PER_ORDER",
                            display: "₹0 for 1st 30 days, then Fixed ₹10/order"
                        },
                        equityOptions: {
                            type: "FLAT",
                            amount: 10,
                            first30Days: 0, // ₹0 for first 30 days
                            basis: "PER_ORDER",
                            display: "₹0 for 1st 30 days, then Fixed ₹10/order"
                        },
                        commodityFutures: {
                            type: "FLAT",
                            amount: 10,
                            basis: "PER_ORDER",
                            display: "Fixed ₹10 per executed order"
                        },
                        commodityOptions: {
                            type: "FLAT",
                            amount: 10,
                            basis: "PER_ORDER",
                            display: "Fixed ₹10 per executed order"
                        },
                        currencyFutures: {
                            type: "FLAT",
                            amount: 10,
                            basis: "PER_ORDER",
                            display: "Fixed ₹10 per executed order"
                        },
                        currencyOptions: {
                            type: "FLAT",
                            amount: 10,
                            basis: "PER_ORDER",
                            display: "Fixed ₹10 per executed order"
                        }
                    },
                    dpCharges: {
                        sell: 15.0,
                        gstApplicable: true,
                        unit: "PER_ISIN",
                        display: "₹15 + 18% GST per ISIN on sell"
                    },
                    otherCharges: {
                        autoSquareOff: 50,
                        callAndTrade: 50,
                        apiSubscription: 0
                    },
                    displayValues: {
                        delivery: "₹0 for 1st 30 days, then 0.20%",
                        intraday: "₹0 for 1st 30 days, then ₹10 or 0.05%",
                        futures: "₹0 for 1st 30 days, then Fixed ₹10/order",
                        options: "₹0 for 1st 30 days, then Fixed ₹10/order",
                        commodities: "Fixed ₹10/order",
                        currency: "Fixed ₹10/order",
                        amc: "1st Year Free, then ₹50/mo + GST (₹600/yr)",
                        accountOpening: "₹0 (Free)",
                        dpCharges: "₹15 + GST per ISIN",
                        autoSquareOff: "₹50 + GST",
                        callAndTrade: "₹50 + GST per order",
                        apiCharges: "Free (Kotak Neo Trade API)"
                    },
                    highlights: [
                        "Standard plan for all investors (30+ years)",
                        "Equity Delivery: ₹0 for first 30 days, then 0.20%",
                        "Intraday & F&O: ₹0 for first 30 days, then Fixed ₹10/order",
                        "1st Year Free AMC (then ₹50/month + GST)"
                    ]
                }
            }
        }
    }
};

/**
 * Helper to calculate brokerage for a given broker, plan, and trade leg.
 */
export function calculateBrokerageForLeg({
    broker,
    plan = "STANDARD",
    productType = "EQUITY_INTRADAY",
    turnover = 0,
    daysSinceOnboarding = 999,
    waivedBrokerageSoFar = 0,
    isPhysicalDelivery = false
}) {
    const brokerKey = String(broker || "UPSTOX").toUpperCase();
    let bConfig = brokerConfig.brokers[brokerKey];

    // Handle plan alias like KOTAK_NEO_YOUTH or KOTAK_NEO_TRADE_FREE
    let selectedPlan = String(plan || "").toUpperCase();
    if (brokerKey === "KOTAK_NEO_YOUTH") {
        bConfig = brokerConfig.brokers.KOTAK_NEO;
        selectedPlan = "YOUTH";
    } else if (brokerKey === "KOTAK_NEO_TRADE_FREE") {
        bConfig = brokerConfig.brokers.KOTAK_NEO;
        selectedPlan = "TRADE_FREE";
    } else if (brokerKey === "KOTAK_NEO" && !selectedPlan) {
        selectedPlan = "TRADE_FREE";
    }

    if (!bConfig) {
        return { brokerage: 0, waived: 0, effectiveRate: "Invalid broker" };
    }

    const planConfig = bConfig.plans?.[selectedPlan] || bConfig.plans?.STANDARD || Object.values(bConfig.plans || {})[0];
    if (!planConfig) {
        return { brokerage: 0, waived: 0, effectiveRate: "Invalid plan" };
    }

    // Normalize product type key
    const p = String(productType).toLowerCase().replace(/[^a-z]/g, "");
    let rateKey = "equityIntraday";
    if (p.includes("deliv") || p === "cnc") rateKey = "equityDelivery";
    else if (p.includes("option")) rateKey = "equityOptions";
    else if (p.includes("future")) rateKey = "equityFutures";
    else if (p.includes("comm") || p.includes("mcx")) rateKey = p.includes("opt") ? "commodityOptions" : "commodityFutures";
    else if (p.includes("curr") || p.includes("fx")) rateKey = p.includes("opt") ? "currencyOptions" : "currencyFutures";

    // Check for physical delivery rule (Dhan 0.10% rule on derivative physical delivery)
    if (isPhysicalDelivery && planConfig.brokerage?.derivativePhysicalDelivery) {
        const physRate = planConfig.brokerage.derivativePhysicalDelivery.percentage || 0.10;
        const b = turnover * (physRate / 100);
        return { brokerage: b, waived: 0, effectiveRate: "0.10% physical delivery" };
    }

    const rate = planConfig.brokerage?.[rateKey];
    if (!rate) {
        return { brokerage: 0, waived: 0, effectiveRate: "Missing rate" };
    }

    // Check promotional waiver (e.g. Kotak Neo first 30 days)
    const isWithin30Days = Number(daysSinceOnboarding) <= 30;
    if (isWithin30Days && rate.first30Days !== undefined) {
        return {
            brokerage: 0,
            waived: 0,
            effectiveRate: "First 30 days introductory offer: ₹0"
        };
    }

    let calculated = 0;
    if (rate.type === "FLAT") {
        calculated = Number(rate.amount || 0);
    } else if (rate.type === "PERCENTAGE") {
        calculated = turnover * (Number(rate.percentage || 0) / 100);
    } else if (rate.type === "LOWER_OF") {
        calculated = Math.min(Number(rate.flat || 0), turnover * (Number(rate.percentage || 0) / 100));
        if (rate.minimum !== undefined && calculated > 0) {
            calculated = Math.max(Number(rate.minimum), calculated);
        }
    }

    // Angel One promotional offer: up to ₹500 brokerage waived in first 30 days
    let waived = 0;
    if (bConfig.id === "ANGEL_ONE" && isWithin30Days && calculated > 0) {
        const remainingCap = Math.max(0, 500 - Number(waivedBrokerageSoFar || 0));
        waived = Math.min(calculated, remainingCap);
        calculated = Math.max(0, calculated - waived);
    }

    const round2 = (val) => Math.round((Number(val || 0) + Number.EPSILON) * 100) / 100;

    return {
        brokerage: round2(calculated),
        waived: round2(waived),
        effectiveRate: rate.display || `${rate.type}`
    };
}

export default brokerConfig;