# POSPal Privacy Notice (Summary)

Effective Date: 2025-08-19
Owner: Anastasia Palamoutsi & Robert Zoumboulis-Airey (Greece)

This document explains what POSPal does with data. POSPal is a local-first application that runs on your own Windows machine. It does not send your business data to any external server by default.

## What POSPal stores locally
POSPal keeps files on your machine (typically in the `data/` folder next to the app):
- `data/menu.json`: Your menu items and categories
- `data/current_order.json`: The currently open order (temporary state)
- `data/device_sessions.json`: Basic device/session info to coordinate multiple devices on the local network
- `data/order_line_counter.json`: Internal counter for order line numbering
- `data/orders_YYYY-MM-DD.csv`: Daily order logs for your records
- `data/trial.json`: Trial start date and signature
- `data/config.json`: App configuration (e.g., printer name, management password)
- `license.key` (next to the executable, not in `data/`): License file that unlocks the full version

## Hardware ID and licensing
- POSPal can display a hardware ID used solely to generate your license file.
- This hardware ID is not transmitted anywhere by POSPal. You share it only if you choose to buy a license.

## Printing
- POSPal uses your selected printer’s name to send print jobs for kitchen/records. No print data is sent outside your local environment by POSPal.

## Networking
- POSPal serves pages on your local network (e.g., tablets/phones on the same Wi‑Fi). Ensure your network is appropriately secured.

## No analytics/telemetry by default
- POSPal does not collect analytics or send usage data to external services by default.

## Your responsibilities (GDPR and local law)
- You are the controller of any personal data you enter into POSPal (e.g., if you add customer names to order notes). POSPal does not act as a cloud processor.
- You should back up and protect your local files and ensure access is restricted to authorized staff.

## Data retention and deletion
- You control retention by managing the files listed above on your own machine.
- To remove data, stop POSPal and delete the relevant files (e.g., daily CSVs) from the `data/` folder.

## Changes to this notice
- This notice may be updated. Check the file packaged with your version or the project repository for updates.

If you have any questions, contact your distributor.
