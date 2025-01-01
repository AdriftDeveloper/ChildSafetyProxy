import fs from "fs/promises";
import path from "path";
import forge from "node-forge";
const { pki, md } = forge;

const CAattrs = [
  { name: "commonName", value: "Predator Hunters Safety" },
  { name: "countryName", value: "GB" },
  { shortName: "ST", value: "England" },
  { name: "localityName", value: "Nottinghamshire" },
  { name: "organizationName", value: "Predator Hunters CA" },
  { shortName: "OU", value: "PH" },
];

const CAextensions = [
  { name: "basicConstraints", cA: true },
  { name: "keyUsage", keyCertSign: true, digitalSignature: true },
  { name: "subjectKeyIdentifier" },
];

const ServerAttrs = [
  { name: "countryName", value: "GB" },
  { shortName: "ST", value: "England" },
  { name: "localityName", value: "Nottinghamshire" },
  { name: "organizationName", value: "Predator Hunters CA" },
  { shortName: "OU", value: "PH Server Certificate" },
];

const ServerExtensions = [
  { name: "basicConstraints", cA: false },
  { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
  { name: "subjectKeyIdentifier" },
];

class CA {
  private baseCAFolder!: string;
  private certsFolder!: string;
  private keysFolder!: string;
  private CAcert!: forge.pki.Certificate;
  private CAkeys!: forge.pki.rsa.KeyPair;

  static async create(caFolder: string): Promise<CA> {
    const ca = new CA();
    ca.baseCAFolder = caFolder;
    ca.certsFolder = path.join(ca.baseCAFolder, "certs");
    ca.keysFolder = path.join(ca.baseCAFolder, "keys");

    await Promise.all([
      fs.mkdir(ca.baseCAFolder, { recursive: true }),
      fs.mkdir(ca.certsFolder, { recursive: true }),
      fs.mkdir(ca.keysFolder, { recursive: true }),
    ]);

    const caExists = await fs
      .access(path.join(ca.certsFolder, "ca.pem"))
      .then(() => true)
      .catch(() => false);

    if (caExists) {
      await ca.loadCA();
    } else {
      await ca.generateCA();
    }
    return ca;
  }

  private generateRandomSerialNumber(): string {
    return Array(4)
      .fill(null)
      .map(() =>
        Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0")
      )
      .join("");
  }

  private async generateCA(): Promise<void> {
    const keys = pki.rsa.generateKeyPair({ bits: 2048 });
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.generateRandomSerialNumber();
    cert.validity.notBefore = new Date();
    cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(
      cert.validity.notBefore.getFullYear() + 1
    );
    cert.setSubject(CAattrs);
    cert.setIssuer(CAattrs);
    cert.setExtensions(CAextensions);
    cert.sign(keys.privateKey, md.sha256.create());

    this.CAcert = cert;
    this.CAkeys = keys;

    await Promise.all([
      fs.writeFile(
        path.join(this.certsFolder, "ca.pem"),
        pki.certificateToPem(cert)
      ),
      fs.writeFile(
        path.join(this.keysFolder, "ca.private.key"),
        pki.privateKeyToPem(keys.privateKey)
      ),
      fs.writeFile(
        path.join(this.keysFolder, "ca.public.key"),
        pki.publicKeyToPem(keys.publicKey)
      ),
    ]);
  }

  private async loadCA(): Promise<void> {
    const [certPEM, keyPrivatePEM, keyPublicPEM] = await Promise.all([
      fs.readFile(path.join(this.certsFolder, "ca.pem"), "utf-8"),
      fs.readFile(path.join(this.keysFolder, "ca.private.key"), "utf-8"),
      fs.readFile(path.join(this.keysFolder, "ca.public.key"), "utf-8"),
    ]);

    this.CAcert = pki.certificateFromPem(certPEM);
    this.CAkeys = {
      privateKey: pki.privateKeyFromPem(keyPrivatePEM),
      publicKey: pki.publicKeyFromPem(keyPublicPEM),
    };
  }

  async generateServerCertificateKeys(
    hosts: string | string[]
  ): Promise<{ certPem: string; keyPrivatePem: string }> {
    if (typeof hosts === "string") {
      hosts = [hosts];
    }
    const mainHost = hosts[0];
    const keys = pki.rsa.generateKeyPair(2048);
    const cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.generateRandomSerialNumber();
    cert.validity.notBefore = new Date();
    cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(
      cert.validity.notBefore.getFullYear() + 1
    );

    const attrs = [...ServerAttrs, { name: "commonName", value: mainHost }];
    cert.setSubject(attrs);
    cert.setIssuer(this.CAcert.issuer.attributes);
    cert.setExtensions([
      ...ServerExtensions,
      {
        name: "subjectAltName",
        altNames: hosts.map((host) =>
          /^[\d.]+$/.test(host)
            ? { type: 7, ip: host }
            : { type: 2, value: host }
        ),
      },
    ]);
    cert.sign(this.CAkeys.privateKey, md.sha256.create());

    const certPem = pki.certificateToPem(cert);
    const keyPrivatePem = pki.privateKeyToPem(keys.privateKey);

    await Promise.all([
      fs.writeFile(
        path.join(this.certsFolder, `${mainHost.replace(/\*/g, "_")}.pem`),
        certPem
      ),
      fs.writeFile(
        path.join(this.keysFolder, `${mainHost.replace(/\*/g, "_")}.key`),
        keyPrivatePem
      ),
    ]);

    return { certPem, keyPrivatePem };
  }

  getCACertPath(): string {
    return path.join(this.certsFolder, "ca.pem");
  }
}

export default CA;
