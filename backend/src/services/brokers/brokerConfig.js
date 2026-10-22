const brokerConfig = {

    // COMMON EXCHANGE / STATUTORY CHARGES

    exchangeCharges: {

        NSE: {

            equityDelivery: {
                buy: 0.0030699,
                sell: 0.0030699,
                unit: "PERCENT",
                basis: "TURNOVER"
            },

            equityIntraday: {
                buy: 0.0030699,
                sell: 0.0030699,
                unit: "PERCENT",
                basis: "TURNOVER"
            },

            equityFutures: {
                buy: 0.0018299,
                sell: 0.0018299,
                unit: "PERCENT",
                basis: "TURNOVER"
            },

            equityOptions: {
                buy: 0.0355299,
                sell: 0.0355299,
                unit: "PERCENT",
                basis: "PREMIUM"
            }
        },

        BSE: {
            note: "Charges depend on scrip group"
        }
    },


    statutoryCharges: {

        GST: {
            rate: 18,
            unit: "PERCENT"
        },

        SEBI: {
            equity: {
                buy: 0.0001,
                sell: 0.0001,
                unit: "PERCENT",
                basis: "TURNOVER"
            }
        },

        STT: {

            equityDelivery: {
                buy: 0.10,
                sell: 0.10,
                unit: "PERCENT",
                basis: "TURNOVER"
            },

            equityIntraday: {
                buy: 0,
                sell: 0.025,
                unit: "PERCENT",
                basis: "TURNOVER"
            },

            equityFutures: {
                buy: 0,
                sell: 0.05,
                unit: "PERCENT",
                basis: "TURNOVER"
            },

            equityOptions: {
                buy: 0,
                sell: 0.15,
                unit: "PERCENT",
                basis: "PREMIUM"
            },

            exercisedOptions: {
                buy: 0.15,
                sell: 0,
                unit: "PERCENT",
                basis: "INTRINSIC_VALUE"
            }
        },


        stampDuty: {

            equityDelivery: {
                buy: 0.015,
                sell: 0,
                unit: "PERCENT",
                basis: "TURNOVER"
            },

            equityIntraday: {
                buy: 0.003,
                sell: 0,
                unit: "PERCENT",
                basis: "TURNOVER"
            },

            equityFutures: {
                buy: 0.002,
                sell: 0,
                unit: "PERCENT",
                basis: "TURNOVER"
            },

            equityOptions: {
                buy: 0.003,
                sell: 0,
                unit: "PERCENT",
                basis: "PREMIUM"
            }
        }
    },


    // BROKER SPECIFIC CHARGES

    brokers: {

        // UPSTOX

        UPSTOX: {

            name: "Upstox",

            brokerage: {

                equityDelivery: {
                    type: "FLAT",
                    amount: 20,
                    unit: "PER_ORDER"
                },

                equityIntraday: {
                    type: "LOWER_OF",
                    flat: 20,
                    percentage: 0.10,
                    unit: "PERCENT",
                    basis: "TURNOVER"
                },

                equityFutures: {
                    type: "LOWER_OF",
                    flat: 20,
                    percentage: 0.05,
                    unit: "PERCENT",
                    basis: "TURNOVER"
                },

                equityOptions: {
                    type: "FLAT",
                    amount: 20,
                    unit: "PER_ORDER"
                }
            },

            dpCharges: {
                equityDelivery: {
                    sell: 20,
                    unit: "PER_SCRIP_PER_DAY"
                }
            },

            otherCharges: {
                apiSubscription: 0,
                autoSquareOff: 75,
                callAndTrade: 75
            }
        },


        // DHAN

        DHAN: {

            name: "Dhan",

            brokerage: {

                equityDelivery: {
                    type: "FLAT",
                    amount: 0,
                    unit: "PER_ORDER"
                },

                equityIntraday: {
                    type: "LOWER_OF",
                    flat: 20,
                    percentage: 0.03,
                    unit: "PERCENT",
                    basis: "TURNOVER"
                },

                equityMTF: {
                    type: "LOWER_OF",
                    flat: 20,
                    percentage: 0.03,
                    unit: "PERCENT",
                    basis: "TURNOVER"
                },

                equityFutures: {
                    type: "FLAT",
                    amount: 20,
                    unit: "PER_ORDER"
                },

                equityOptions: {
                    type: "FLAT",
                    amount: 20,
                    unit: "PER_ORDER"
                }
            },

            dpCharges: {
                equityDelivery: {
                    amount: 12.50,
                    unit: "PER_ISIN"
                }
            },

            otherCharges: {
                apiSubscription: 0,
                autoSquareOff: 20,
                callAndTrade: 50
            }
        },


        // ANGEL ONE

        ANGEL_ONE: {

            name: "Angel One",

            brokerage: {

                equityDelivery: {
                    type: "LOWER_OF",
                    flat: 20,
                    percentage: 0.10,
                    minimum: 5,
                    unit: "PERCENT",
                    basis: "TURNOVER"
                },

                equityIntraday: {
                    type: "LOWER_OF",
                    flat: 20,
                    percentage: 0.10,
                    minimum: 5,
                    unit: "PERCENT",
                    basis: "TURNOVER"
                },

                equityFutures: {
                    type: "FLAT",
                    amount: 20,
                    unit: "PER_ORDER"
                },

                equityOptions: {
                    type: "FLAT",
                    amount: 20,
                    unit: "PER_ORDER"
                }
            },

            dpCharges: {
                equityDelivery: {
                    sell: 20,
                    unit: "PER_ISIN"
                }
            },

            otherCharges: {
                apiSubscription: 0
            }
        }
    }
};

export default brokerConfig;