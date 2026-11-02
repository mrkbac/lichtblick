// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Browser stand-in for the two functions xmlbuilder2 (via @foxglove/xmlrpc) imports from Node's
// "url" module. The WHATWG URL parser does the same IDNA conversion.

export function domainToASCII(domain: string): string {
  try {
    return new URL(`http://${domain}`).hostname;
  } catch {
    return "";
  }
}

export function domainToUnicode(domain: string): string {
  // Browsers expose no punycode decoder; the ASCII form is a valid hostname too
  return domainToASCII(domain);
}
