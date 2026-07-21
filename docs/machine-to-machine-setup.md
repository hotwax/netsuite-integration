# NetSuite Machine-to-Machine (M2M) OAuth 2.0 Setup

This guide provides a simple step-by-step walkthrough to set up NetSuite Machine-to-Machine (M2M) OAuth 2.0 authentication. 

> [!NOTE]
> To perform these steps, you must log in to NetSuite using a user account with the **Administrator** role.

---

## Step 1: NetSuite Account ID
1. Navigate to **Setup > Company > Company Information**.
2. Find the **Account ID** listed on the screen and copy it for future use.


---

## Step 2: Enable Required Features
Before setting up integration records, ensure that the necessary integration and authentication features are enabled in NetSuite.
1. Navigate to **Setup > Company > Enable Features**.
2. Click on the **SuiteCloud** tab.
3. Under the **Manage Authentication** section, check **OAuth 2.0**.
4. Under the **SuiteTalk (Web Services)** section, check **REST Web Services** (and **RESTlets** if available).
5. Click **Save**.

---

## Step 3: Create an Integration
Create a new integration record in NetSuite to represent the client application.
1. Navigate to **Setup > Integrations > Manage Integrations**.
2. Click the **New** button.
3. Configure the following fields:
   * **Name**: Enter a descriptive name (e.g., `HotWax Integration`).
   * **State**: `Enabled`.
4. Under the **OAuth 2.0** section, check the following options:
   * **Token-Based Authentication**
   * **TBA: IssueToken Endpoint**
   * **TBA: Authorization Flow**
   * **RESTlet and REST Web Services**
   * **Authorization Code Grant**
   * **Client Credentials (Machine To Machine) Grant**
5. Set the **Callback URL** and **Redirect URL** to:
   * `https://www.hotwax.co`
6. Click **Save**.
7. > [!IMPORTANT]
   > Immediately copy and securely save the following credentials displayed at the bottom of the page:
   > * **Consumer Key (Client ID)**
   > * **Consumer Secret (Client Secret)**
   > 
   > *Note: These keys are only shown once.*

---

## Step 4: Generate a Certificate
A valid certificate is required for the OAuth 2.0 Client Credentials flow. 

### Certificate Conditions:
* **Format**: The public key must be in x.509 format with the file extension `.cer`, `.pem`, or `.crt`.
* **Key Length**:
  * RSA key length: `3072` or `4096` bits.
  * EC (Elliptic Curve) key length: `256`, `384`, or `521` bits.
* **Validity**: Maximum validity of **2 year (730 days)**.
* **Uniqueness**: A unique certificate is required for each integration record, role, and entity mapping.

### Generate Certificate using OpenSSL:
Run the following command in a terminal/local machine to generate the public key and private key:

```bash
openssl req -new -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 730 -out public.pem -keyout private.pem
```

This command will generate two files:
* `public.pem` (Your public certificate to upload to NetSuite)
* `private.pem` (Your private key to keep secure)

---

## Step 5: Map Client Credentials in NetSuite
Map the Integration record, User Entity, and Role with your public key.
1. Navigate to **Setup > Integration > Manage Authentication > OAuth 2.0 Client Credentials (M2M) Setup**.
2. Click **Create New** (or **New**).
3. In the setup window, configure the following fields:
   * **Entity**: Select the integration employee/user.
   * **Role**: Select `Administrator` (or your custom integration role).
   * **Application**: Select the Integration application created in Step 3.
4. Upload your generated public key file (`public.pem`).
5. Click **Save**.
6. Note down the generated **Certificate ID** (Example: `Kny7lnPgsorJ-IHAULxauxKTNUugGYvMJIiqftm-8_U`).
