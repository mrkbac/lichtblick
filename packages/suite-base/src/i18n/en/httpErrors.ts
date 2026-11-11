// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export const httpErrors = {
  networkError: "Network connection error. Please check your connection.",
  badRequest: "Invalid request. Please check your input and try again.",
  unauthorized: "You are not authenticated.",
  forbidden: "You do not have permission to perform this action.",
  notFound: "The requested resource was not found.",
  conflict: "The resource already exists or has been modified.",
  internalServerError: "Server error. Please try again later.",
  clientError: "Request error. Please check your input and try again.",
  serverError: "Server error. Please try again later.",
  remoteFileCors:
    "The server at {{origin}} blocked this site from reading the file (CORS). It must send an Access-Control-Allow-Origin header that allows {{appOrigin}} (or *), and Access-Control-Expose-Headers: Accept-Ranges, Content-Length.",
  remoteFileCorsCredentials:
    "The server at {{origin}} blocked this site from reading the file with credentials (CORS). Because this link sends cookies, the server must send Access-Control-Allow-Credentials: true and Access-Control-Allow-Origin: {{appOrigin}} (a wildcard * is not allowed for requests with credentials), and Access-Control-Expose-Headers: Accept-Ranges, Content-Length.",
  remoteFileUnreachable:
    "Couldn't read from {{origin}}. The server may be unreachable (check the URL and your network connection), or it blocks reads from other sites with CORS or Cross-Origin-Resource-Policy. ({{error}})",
};
