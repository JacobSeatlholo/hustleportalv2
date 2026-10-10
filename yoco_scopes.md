> For clean Markdown of any page, append .md to the page URL.
> For a complete documentation index, see https://developer.yoco.com/llms.txt.
> For AI client integration (Claude Code, Cursor, etc.), connect to the MCP server at https://developer.yoco.com/_mcp/server.

This page outlines the scopes available for the Yoco API.

> **Note**
>
> To view which scopes apply to a given API endpoint, refer to the API reference.

## Yoco API scopes

The following scopes control access to Yoco API resources and are available for both personal and
OAuth applications:

### `application/webhooks:read`

Allow viewing of your webhook subscriptions.

### `application/webhooks:write`

Allow management of your webhook subscriptions.

### `business/capital_advances:read`

Allow viewing of your business capital advances.

### `business/capital_offers:read`

Allow viewing of your business capital offers.

### `business/catalogue:read`

Allow viewing of your business catalogue.

### `business/devices:read`

Allow viewing of your business devices.

### `business/locations:read`

Allow viewing of your business locations.

### `business/orders:read`

Allow viewing of your business orders, payments & refunds.

### `business/orders:write`

Allow creation of your business orders & payment links.

### `business/payouts:read`

Allow viewing of your business payouts.

### `business/products:read`

> **Warning**
>
> This scope is deprecated. Use `business/catalogue:read` instead.

Allow viewing of your business products.

### `business/staff:read`

Allow viewing of your business staff.

## OAuth application-only scopes

The following scopes are available only for OAuth applications:

### `business/webpos:read`

Allow viewing of Web Point of Sale payment request progress & results.

### `business/webpos:write`

Allow creation of Web Point of Sale payment requests.

### `offline_access`

Allow access to your account while you're not logged in.

### `openid`

Allows the application to receive an `id_token`, which contains information about the authenticated
user.

The following information about the authenticated user is available in the `id_token`:

* `user_id`: The unique identifier for the user.
* `default_business_id`: The unique identifier for the user's default business. Note: this may
  differ from the `authorized_business_id`, which refers to the business that the user authorised
  during the OAuth 2.0 consent flow.
* `business_ids`: A list of all businesses associated with the user.

Additionally, by requesting the `id_token`, the application also receives access to the `/userinfo`
endpoint, which returns the same information about the authenticated user.

### `profile`

Access to the end user's full name and email address. The `id_token` and `/userinfo` endpoints
return this additional information.

The following additional fields are available:

* `user_name`: The user's full name.
* `user_email`: The user's email address.