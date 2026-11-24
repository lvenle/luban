export class NoRestrictionLicenseProvider {
  async entitlements() {
    return { unrestricted: true, features: ['*'], expires_at: null };
  }

  async assertAllowed() {
    return true;
  }
}
