# NetSuite Integration Setup & Data Synchronization Guide

This guide describes the manual configuration steps, deployment workflow, and data synchronization processes required to set up the HotWax Commerce NetSuite integration.

---

## 1. Code Deployment Process

The project is deployed using the local Machine-to-Machine (M2M) configuration via Visual Studio Code and the **SuiteCloud CLI** extension.

> [!IMPORTANT]
> Only files and objects configured inside `src/deploy.xml` will be deployed to the NetSuite environment when running the deploy command. If you add new scripts or custom records/fields, ensure they are added to `deploy.xml`.

1. Authenticate with the target NetSuite environment using the SuiteCloud CLI.
2. Review and validate changes in VS Code.
3. Deploy the project components using the SuiteCloud CLI deploy command.

---

## 2. SFTP Configuration & API Secret Setup

NetSuite integration scripts upload and download CSV data via an SFTP server. The credentials must be securely stored in NetSuite using API Secrets and mapped via the custom SFTP Configuration record.

### Step 1: Create the API Secret in NetSuite
1. Navigate to **Setup > Company > API Secrets**.
2. Click **Generate New Secret**.
3. Configure the following fields:
   * **Name**: Choose a descriptive name (e.g., `HotWax SFTP Password`).
   * **ID**: Set to `786` (or copy the generated ID).
   * **Password**: Enter the SFTP password.
4. Under **Restrictions**, configure the following:
   * Check **Allow for all scripts** = `True`
   * Check **Allow for all domains** = `True`
5. Click **Save**.
6. Copy the generated secret reference key/ID and temporarily store it on your local machine.

### Step 2: Retrieve the SFTP Host Key
Run the `ssh-keyscan` command in a local terminal to retrieve the public host key of the SFTP server:
```bash
ssh-keyscan -t <hostKeyType> -p <port> <hostDomain>
```
*Example:*
```bash
ssh-keyscan -t ECDSA -p 22 hc-uat.hotwax.io
```

### Step 3: Create the SFTP Configuration Custom Record
1. Navigate to **Customization > Lists, Records & Fields > Record Types > New**.
2. Create the record with the name `HC SFTP Configuration` (Internal ID: `customrecord_ns_sftp_configuration`).
3. Create a record instance and populate the configuration fields:

| Field Label | Field ID | Value |
| :--- | :--- | :--- |
| **SFTP Server** | `custrecord_ns_sftp_server` | SFTP domain/IP (e.g. `sftp.hotwax.io`) |
| **User ID** | `custrecord_ns_sftp_userid` | SFTP username |
| **Port** | `custrecord_ns_sftp_port_no` | SFTP port number (e.g. `22`) |
| **Host Key** | `custrecord_ns_sftp_host_key` | Copy/paste the full output key from the `ssh-keyscan` command |
| **SFTP GUID** | `custrecord_ns_sftp_guid` | Paste the API Secret ID / token (from Step 1) |
| **Default File Directory** | `custrecord_ns_sftp_default_file_dir` | SFTP root upload folder path (e.g., `/hotwax/`) |

4. Click **Save**.

---

## 3. Initialize SFTP Directories

Before running data sync scripts, the integration directory structure must be initialized on the SFTP server.

* **Script**: `HC_SC_CreateSFTPDirectory.js` (Scheduled Script)
* **Action**: Run this script manually in NetSuite once. It connects to the SFTP server and creates all required directories (e.g., `/salesorder`, `/product`, `/inventoryitem`, `/transferorder`, etc.).

---

## 4. Product Synchronization & Good Identification

Products in NetSuite must sync with the OMS to map identifier keys (Good Identification).

### Sync Flow:
1. This process runs **after** the Shopify Product Sync completes.
2. The Scheduled Script **`HC_SC_GenerateProductCSV.js`** generates the product CSV file and saves it in the NetSuite File Cabinet folder at the scheduled time.
3. The Scheduled Script **`HC_SC_UploadProductCSV.js`** reads the CSV from the File Cabinet and uploads it to the SFTP server path (e.g. `product/csv/`).
4. To import the data in the HotWax OMS, trigger the Master Data Management (MDM) endpoint:
   ```http
   GET /commerce/control/ImportData?configId=IMP_PROD_IDENT
   ```

### Sample CSV Structure:
The generated CSV file maps NetSuite internal IDs to OMS product identification values (using tab-separated columns):

```csv
id-value,good-identification-value,goodIdentificationType
#9 Damage Stickers,35872,NETSUITE_PRODUCT_ID
051-0221-G,521,NETSUITE_PRODUCT_ID
051-0221-R,523,NETSUITE_PRODUCT_ID
```

* **`id-value`**: The product identifier/SKU.
* **`good-identification-value`**: The corresponding NetSuite internal ID to map in the OMS.

---

## 5. Warehouse & Store Facility Setup

For inventory sync to function correctly, warehouse and store physical locations must exist in both systems.

* All Store and Warehouse Facilities in HotWax Commerce OMS are created manually or imported via CSV.
* > [!IMPORTANT]
  > **Facility ID** and **External ID** in HotWax Commerce OMS must match the corresponding **NetSuite Internal ID** of the respective Location.

### Facility Setup CSV Structure:
If importing facilities in bulk, use the following CSV headers and format:

```csv
facility-id,external-id,facility-name,owner-party-id,facility-type-id,inventory-item-type-id,days-to-ship,description,weight-uom-id,do-picking,maximum-order-limit,require-inspection,to-name,address-line-1,address-line-2,city,zip-code,state,country,latitude,longitude,phone-number,email,map-url,open-time,close-time
SALT_LAKE_CITY,83211747439,Salt Lake City,COMPANY,RETAIL_STORE,,,,,N,5,N,Salt Lake City,1110 S 300 W,,Salt Lake City,84010,UT,US,,,18012363918,,,,
SHOP_LOCATION,82557468783,Shop location,COMPANY,RETAIL_STORE,,,,,N,,N,,,,,,,,,,,,,,
```

* **`facility-id`**: Unique ID identifier for the facility.
* **`external-id`**: The matching NetSuite Location Internal ID.
* **`facility-name`**: Readable name of the facility.
* **`facility-type-id`**: Type of the facility (e.g., `RETAIL_STORE`, `WAREHOUSE`).

---

## 6. Inventory Synchronization

Once facility mappings are complete, inventory levels can be synced from NetSuite to the HotWax OMS.

### Sync Flow:
1. The Scheduled Script **`HC_generateCSV_InventoryItems.js`** generates the inventory levels CSV file from NetSuite inventory data.
2. The Scheduled Script **`HC_uploadCSV_InventoryItems.js`** uploads the inventory CSV file to the SFTP server path (e.g., `inventoryitem/csv/`).
3. To reset and update inventory levels in the HotWax OMS, trigger the MDM endpoint:
   ```http
   POST /commerce/control/ImportData?configId=RESET_INVENTORY
   ```
   
   **Request Parameters (JSON):**
   ```json
   {
     "reason": "VAR_EXT_RESET",
     "idType": "NETSUITE_PRODUCT_ID",
     "comments": "NetSuite",
     "groupBy": "facilityId",
     "locationSeqId": "TLTLTLLL01"
   }
   ```

### Sample CSV Structure (Inventory Reset):
The generated CSV file maps the inventory levels across facilities (using tab-separated columns):

```csv
Item,externalFacilityId,availableQty,idValue
051-0221-G,139,0,521
051-0221-G,39,0,521
```

* **`Item`**: The Product identifier/SKU.
* **`externalFacilityId`**: The NetSuite Internal ID of the location (matching `Facility ID` / `External ID` in the OMS).
* **`availableQty`**: The quantity available for sale at that location.
* **`idValue`**: The NetSuite Internal ID of the product.