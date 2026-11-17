const countryData = require("country-data");

const currencyCorrections = {
    BG: "EUR",
    BY: "BYN",
    HR: "EUR",
    MR: "MRU",
    SL: "SLE",
    ST: "STN",
    VE: "VES"
};

function getCurrencyDetails(currencyCode, countryCode) {
    const symbolOverrides = {
        NGN: "\u20A6",
        GHS: "GH\u20B5",
        ZAR: "R",
        USD: "$",
        BYN: "Br",
        MRU: "UM",
        SLE: "Le",
        STN: "Db",
        VES: "Bs",
        BHD: "BHD"
    };

    const locale = countryCode
        ? "en-" + countryCode
        : "en";

    const formatter = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: currencyCode,
        currencyDisplay: "narrowSymbol"
    });

    const currencyPart = formatter
        .formatToParts(1)
        .find(part => part.type === "currency");

    return {
        currencyCode,
        currencySymbol:
            symbolOverrides[currencyCode] ||
            (currencyPart ? currencyPart.value : currencyCode),
        currencyExponent:
            formatter.resolvedOptions().maximumFractionDigits
    };
}

const countries = countryData.countries.all
    .filter(country =>
        country.status === "assigned" &&
        /^[A-Z]{2}$/.test(String(country.alpha2 || "")) &&
        country.alpha2 !== "AQ"
    )
    .map(country => {
        const currencyCode =
            currencyCorrections[country.alpha2] ||
            (Array.isArray(country.currencies)
                ? country.currencies[0]
                : null);

        if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
            throw new Error(
                `Missing valid currency mapping for ${country.alpha2}`
            );
        }

        const currency = getCurrencyDetails(currencyCode, country.alpha2);

        return {
            countryCode: country.alpha2,
            countryName: country.name,
            flag: country.emoji || "",
            ...currency
        };
    })
    .sort((a, b) =>
        a.countryName.localeCompare(b.countryName)
    );

const countryMap = new Map(
    countries.map(country => [country.countryCode, country])
);

const supportedCurrencyCodes = [
    ...new Set(countries.map(country => country.currencyCode))
].sort();

function getCountries() {
    return countries.map(country => ({ ...country }));
}

function getCountryByCode(countryCode) {
    const code = String(countryCode || "").trim().toUpperCase();
    const country = countryMap.get(code);
    return country ? { ...country } : null;
}

function getSupportedCurrencyCodes() {
    return [...supportedCurrencyCodes];
}

module.exports = {
    getCountries,
    getCountryByCode,
    getSupportedCurrencyCodes
};
