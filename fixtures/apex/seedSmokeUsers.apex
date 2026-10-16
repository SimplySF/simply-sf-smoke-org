// Idempotent, org-specific standard user. Never modify the running admin.
String username = 'sso.apex.' + UserInfo.getOrganizationId().toLowerCase() + '@example.com';
List<User> existing = [SELECT Id, IsActive FROM User WHERE Username = :username];
if (existing.isEmpty()) {
    Profile standard = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
    insert new User(Username = username, Email = username, Alias = 'ssoapex',
        LastName = 'SSO Apex Smoke', ProfileId = standard.Id,
        TimeZoneSidKey = 'America/New_York', LocaleSidKey = 'en_US',
        EmailEncodingKey = 'UTF-8', LanguageLocaleKey = 'en_US');
} else {
    System.assert(existing[0].IsActive, 'Seeded smoke user must be active');
}
