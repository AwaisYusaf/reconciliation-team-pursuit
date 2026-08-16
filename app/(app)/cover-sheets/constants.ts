/**
 * Shared by the page (server) and the selector (client).
 *
 * Deliberately not exported from the `"use client"` selector module: a value imported from a
 * client module into a server component arrives as a client-reference proxy rather than the
 * value itself, so `requested === ALL_LINE_ITEMS` silently evaluated false on the server and
 * "All Line Items" rendered a single sheet. A neutral module is the value both sides see.
 */
export const ALL_LINE_ITEMS = "all";
