# Natural Inventory Keeper

MASTER BUILD PROMPT — MASTER POS INVENTORY

You are a senior frontend architect, UI/UX designer, JavaScript engineer, database architect, and PWA specialist.

Build a complete, production-quality, fully functional Offline-First Inventory Management SPA called Natural Cosmetics Inventory for natural cosmetics and Moroccan beauty products.

1. TECHNOLOGY

Use only:

HTML5

CSS3

Vanilla JavaScript ES6+

IndexedDB

Service Worker

Browser Web APIs

Do NOT use React, Vue, Angular, Svelte, Next.js, Node.js, PHP, Python, Docker, external databases, required cloud services, CDN dependencies, remote APIs, online fonts, or external authentication.

The application must work after the first load without Internet.

2. CORE REQUIREMENT

This must be a real working application, not a mockup.

Every navigation item, button, form, table action, search, filter, CRUD operation, stock operation, report, import/export, backup, and setting must work.

No:

fake buttons

TODOs

Coming Soon

empty pages

dead links

placeholder functionality

If something cannot be implemented exactly, create the best functional browser-based alternative.

3. MAIN MODULES

Implement:

Dashboard

Products

Categories

Inventory

Stock Movements

Batches/Lots

Expiry Center

Suppliers

Customers

Purchases

Sales

Reports

Analytics

Notifications

Activity Log

Import/Export

Backup/Restore

Settings

Also support:

Barcode/QR

FEFO

Inventory forecasting

Reorder recommendations

ABC analysis

Arabic/French/English

RTL/LTR

Light/Dark/System themes

Responsive desktop/tablet/mobile UI

PWA installation

Offline operation

IndexedDB persistence

4. UI/UX

Create a premium, professional business dashboard inspired by the provided reference, but do not copy it.

Use:

clean application shell

responsive sidebar

topbar with search, notifications, language and theme

professional cards/tables

charts

badges

modals

confirmation dialogs

tooltips

hover/focus states

loading/error/success/empty states

accessible controls

Prioritize usability and business functionality. Avoid excessive futuristic/AI visual effects.

Responsive behavior

Desktop:

full sidebar

Tablet:

collapsible sidebar

Mobile:

drawer navigation

responsive cards

mobile-friendly tables/forms/modals

appropriate bottom navigation

5. SPA ROUTING

Use lightweight hash routing:

#/dashboard

#/products

#/inventory

#/movements

#/categories

#/suppliers

#/customers

#/purchases

#/sales

#/expiry

#/reports

#/analytics

#/notifications

#/settings

Navigation must not reload the page. Browser back/forward must work.

6. PROJECT STRUCTURE

Use modular architecture:

master-pos-inventory/

├── index.html

├── manifest.json

├── sw.js

├── assets/

├── css/

│   ├── variables.css

│   ├── reset.css

│   ├── layout.css

│   ├── components.css

│   ├── forms.css

│   ├── tables.css

│   ├── dashboard.css

│   ├── responsive.css

│   └── themes.css

├── js/

│   ├── app.js

│   ├── router.js

│   ├── state.js

│   ├── i18n.js

│   ├── database.js

│   ├── seed.js

│   ├── modules/

│   ├── components/

│   └── utils/

└── data/

    └── seed-data.js

Keep modules reusable and avoid one huge JavaScript file.

7. INDEXEDDB

Create:

NaturalCosmeticsDB

Stores:

products

categories

brands

suppliers

customers

batches

inventory

stockMovements

purchaseOrders

purchaseItems

sales

saleItems

notifications

settings

activityLog

Provide reusable database functions:

create

read

readAll

update

delete

bulkInsert

bulkUpdate

query

count

clear

Support indexes, validation, transactions, migrations/versioning, and error handling.

Do not use LocalStorage as the primary database.

8. PWA / OFFLINE

Create  and .

Cache the complete application shell:

HTML

CSS

JavaScript

icons

local assets

After the first load:

Disconnecting Internet must not break core functionality.

No core feature may require a server, API, CDN, or cloud service.

9. LOCALIZATION

Support Arabic and French English using centralized translation dictionaries.

Default:

Arabic / RTL

English:

LTR



French:

LTR



Changing language must update the entire UI including navigation, tables, forms, modals, charts, formatting and alignment.

Persist language preference in IndexedDB.

Default currency:

DZ

Allow currency configuration in Settings.

10. PRODUCTS

Product model:

id

nameAr

nameEn

nameFr

sku

barcode

categoryId

brandId

descriptionAr

descriptionEn

unit

purchasePrice

sellingPrice

quantity

minimumStock

maximumStock

reorderPoint

supplierId

image

status

createdAt

updatedAt

Statuses:

Active

Inactive

Discontinued

Product table must support:

search

filtering

sorting

pagination

column visibility

multi-select

bulk actions

responsive layout

Product details must show prices, stock, batches, expiry, supplier, sales/purchase history, movements, estimated remaining days and profit margin.

11. CATEGORIES

Seed realistic categories including:

Other

Support Arabic Frensh and English names and full CRUD.

12. INVENTORY

Show:

total units

inventory value

healthy stock

low stock

critical stock

out of stock

overstocked

Inventory status logic:

Healthy

Low

Critical

Out of Stock

Overstocked

Every stock change must create a movement.

Movement types:

STOCK_IN

STOCK_OUT

SALE

PURCHASE

RETURN

DAMAGED

EXPIRED

ADJUSTMENT

TRANSFER

Never allow negative stock unless explicitly enabled in Settings.

13. BATCHES + FEFO + EXPIRY

Track:

batchNumber

productId

manufacturingDate

expiryDate

quantity

purchasePrice

supplierId

createdAt

Products can have multiple batches.

Implement:

FEFO — First Expired, First Out

When stock is deducted, automatically consume the batch with the nearest expiry date and record which batch was used.

Expiry Center must show:

expired

within 7 days

within 30 days

within 60 days

within 90 days

Statuses:

Expired

Critical

Expiring Soon

Safe

14. SUPPLIERS + CUSTOMERS

Suppliers:

name

company

phone

email

address

city

notes

status

createdAt

Show purchase history, total purchases, products, last purchase and outstanding balance.

Customers:

name

phone

email

address

notes

createdAt

Show orders, total spending, last purchase and purchase history.

15. PURCHASES

Purchase orders must support:

PO Number

Supplier

Date

Products

Quantities

Unit Cost

Discount

Tax

Shipping

Total

Payment Status

Order Status

Notes

Statuses:

Draft

Ordered

Partially Received

Received

Cancelled

Receiving a purchase must:

increase inventory

create/update batches

create stock movements

update dashboard data

Use IndexedDB transactions for multi-record operations.

16. SALES

Sales must support:

Invoice Number

Customer

Date

Products

Quantity

Selling Price

Discount

Tax

Total

Payment Method

Payment Status

Notes

Payment methods:

Cash

Card

Bank Transfer

Other

Completing a sale must:

validate stock

select batches using FEFO

decrease inventory

update batch quantities

create stock movements

record the sale

update analytics/notifications

17. DASHBOARD

Create dynamic KPI cards:

Total Products

Total Stock

Inventory Value

Low Stock

Critical Stock

Out of Stock

Expiring Soon

Today's Sales

Monthly Sales

Monthly Purchases

Estimated Gross Profit

Cards should navigate to relevant modules.

Charts:

Sales Overview

Stock by Category

Top Products

Inventory Value

Stock Health

Purchases vs Sales

Expiry Overview

ABC Analysis

Charts must be generated locally using Canvas/SVG/JavaScript and use real IndexedDB data, never hardcoded values.

18. INVENTORY INTELLIGENCE

Implement local JavaScript analytics.

Generate insights such as:

fast-selling products

products approaching reorder point

products expiring soon

overstocked products

sales trends

recommended reorder quantity

Use simple formulas, not external AI.

Forecast:

Average Daily Sales = Total Sold / Number of Days

Estimated Days Remaining = Current Stock / Average Daily Sales

Clearly label this:

Simple Forecast / Estimated Demand

Create a Reorder Center with:

Product

Current Stock

Average Daily Sales

Reorder Point

Recommended Quantity

Supplier

Allow creating a Purchase Order directly from a recommendation.

19. ABC ANALYSIS

Classify products as:

A

B

C

based on sales/inventory value.

Show:

number of products

percentage

value contribution

visual chart

20. SEARCH + BARCODE

Global search across:

products

SKU

barcode

suppliers

customers

purchases

sales

batches

Show grouped results.

Barcode support:

barcode field

barcode lookup

manual entry

QR generation where possible

camera scanning where browser permissions support it

Camera scanning must be optional; manual entry must always work.

21. NOTIFICATIONS + ACTIVITY LOG

Notification types:

Low Stock

Critical Stock

Out of Stock

Expiry

Purchase Received

Sales Alert

System

Support mark read, mark all read, delete and filtering.

Activity log must track important actions such as product changes, stock changes, sales, purchases, settings, backups and restores.

22. REPORTS

Implement:

Inventory Report

Low Stock Report

Expiry Report

Sales Report

Purchase Report

Profit Report

Supplier Report

Product Performance Report

Stock Movement Report

Every report supports:

date range

filters

search

totals

print

CSV export

Profit:

Profit per Unit = Selling Price - Purchase Price

Estimated Gross Profit = Revenue - Cost of Goods Sold

Label it Estimated Gross Profit because operating expenses are excluded.

Inventory valuation:

Inventory Value = Current Stock × Purchase Cost

23. IMPORT / EXPORT / BACKUP

CSV export/import for:

products

inventory

sales

purchases

suppliers

customers

CSV import workflow:

Upload → Validate → Preview → Errors → Confirm → Import

Never silently overwrite records.

Full backup:

JSON

Include all IndexedDB stores.

Filename:

natural-cosmetics-backup-YYYY-MM-DD.json

Restore workflow:

Select → Validate → Summary → Confirm → Backup Current Data → Restore → Refresh

Never destroy existing data without explicit confirmation.

24. DEMO DATA

Initialize with realistic demo data:

25–40 products

categories

suppliers

customers

multiple batches

sales

purchases

stock movements

different expiry dates

healthy stock

low stock

critical stock

out-of-stock

expired/expiring products

Use products such as:

Other

Provide:

Reset Demo Data

Clear All Data

with strong confirmations.

25. SETTINGS

Include:

General

Store Name

Currency

Language

Date Format

First Day of Week

Inventory

Minimum Stock

Reorder Point

Allow Negative Stock

Expiry Warning Days

Enable FEFO

Notifications

Low Stock Alerts

Expiry Alerts

Sales Alerts

Appearance

Light

Dark

System

Data

Backup

Restore

Import

Export

Reset Demo Data

Clear Database

26. ACCESSIBILITY + UX

Implement:

semantic HTML

keyboard navigation

visible focus

ARIA labels

accessible modals

proper form labels

sufficient contrast

screen-reader-friendly messages

Shortcuts:

Ctrl/Cmd + K → Global Search

Esc → Close Modal

Every form must validate required fields, quantities, prices, dates, duplicate SKU/barcode, CSV and backup files.

Use reusable:

Modal

ConfirmDialog

Toast

Table

Pagination

Search

Filter

Dropdown

Tabs

Badge

Tooltip

EmptyState

StatCard

Chart

Timeline

27. DATA SAFETY

Never:

send inventory data externally

send API keys

use analytics trackers

depend on remote services for core features

Use IndexedDB transactions whenever an operation modifies multiple related records.

For example, a sale should atomically update:

Sale

→ Sale Items

→ Inventory

→ Batches

→ Stock Movements

→ Notifications

28. PERFORMANCE

Optimize for:

fast startup

efficient IndexedDB queries

minimal DOM updates

pagination

debounced search

lazy rendering

thousands of records

minimal dependencies

29. REAL-TIME UI

When data changes, update affected views immediately without page reload.

Example: creating a sale should update inventory, KPIs, profit, charts, top products, movements and notifications.

All dashboard values must be dynamically calculated from IndexedDB.

30. PRINTING + IMAGES

Provide printable layouts for:

sales invoice

purchase order

inventory report

expiry report

stock movement report

Use .

Allow local product image selection without server uploads.

31. DEVELOPMENT ORDER

Build in this order:

1. Application Shell

2. Design System

3. IndexedDB

4. Localization

5. Products/Categories

6. Inventory/Movements

7. Batches/Expiry/FEFO

8. Suppliers/Purchases

9. Customers/Sales

10. Dashboard/Analytics

11. Reports

12. Import/Export

13. Backup/Restore

14. PWA/Offline

15. Responsive Optimization

16. Testing/Fixes

Do not skip dependencies.

32. TESTING

Before completion, test:

navigation

browser history

CRUD

search/filter

Arabic/English/French

RTL/LTR/LTR

themes

products

stock in/out

purchases

sales

FEFO

batches

expiry

notifications

reports

CSV import/export

backup/restore

IndexedDB persistence

responsive UI

offline reload

Final offline test:

Load App

→ Disconnect Internet

→ Reload

→ Create Product

→ Create Sale

→ Adjust Stock

→ Generate Report

→ Export Backup

Everything must continue working.

33. FINAL QUALITY RULE

Do not stop at the UI.

If an implementation problem occurs:

Diagnose → Fix → Test → Continue

Never replace required functionality with placeholders.

The final project must be immediately runnable with:

index.html

manifest.json

sw.js

css/

js/

assets/

data/

On first launch show:

Arabic Dashboard / RTL + realistic demo data

The user can switch to:

English / LTR

SUCCESS CRITERIA

The application is complete only when this workflow works end-to-end:

Add Product

→ Category

→ Supplier

→ Batch

→ Stock

→ Inventory

→ Purchase

→ Receive Purchase

→ Inventory Increases

→ Customer

→ Sale

→ FEFO Batch Selection

→ Inventory Decreases

→ Stock Movement

→ Analytics Update

→ Profit Update

→ Low Stock Notification

→ Expiry Update

→ Report

→ CSV Export

→ Full Backup

→ Disconnect Internet

→ Reload

→ Data Persists

Build the complete working application now. Generate all required files and functionality, not an explanation or mockup.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/abefe360-63a8-48b1-b574-204c5a8352a0).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
Everything works: POS terminal renders 34 product cards, cart adds lines, the 3-tab product modal (with variant matrix, bulk fill, barcode generator) opens, and the ZIP backup screen loads with JSZip available — no console errors.
```
Added on top of the existing app:

POS terminal #/pos: product grid with stock/FEFO batch tags, live cart with qty/price editing, barcode scan field, red Return Mode with negative sums, holds, drafts (proforma/order), history reprint, auto-print toggle, and F1–F5 shortcuts.
3-tab product modal: basic info + additional barcodes + initial batch with 0/10/20/30/50% margin presets; attributes, wholesale packs and tiered prices; variant matrix generator with option-group tags, bulk fill (تعميم), empty-barcode generation, and override warning.
ZIP backup center #/backup (JSZip bundled locally: database.json + CSVs + images, plus restore) and LAN sync #/network (device role, discovery, sync log).
Electron desktop: electron/main.cjs with dependency-free WebSocket server on 8080 + UDP discovery on 41234, preload.cjs bridge, and electron-builder.yml (run npm i -D electron @electron/packager then npm run electron to launch the desktop build).
```
