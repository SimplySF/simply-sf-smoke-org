// Fixture objects are dedicated to these suites; leave unrelated records alone.
delete [SELECT Id FROM SSO_Data_Child__c];
delete [SELECT Id FROM SSO_Data_Parent__c];
List<SSO_Data_Parent__c> parents = new List<SSO_Data_Parent__c>();
List<String> keys = new List<String>{'A', 'A', 'B', 'B', 'C', 'D'};
for (Integer i = 0; i < keys.size(); i++) {
    parents.add(new SSO_Data_Parent__c(Name='SSO Parent '+i, SSO_Key__c=keys[i], SSO_Status__c='Initial', SSO_Amount__c=10));
}
insert parents;
List<SSO_Data_Child__c> children = new List<SSO_Data_Child__c>();
for (Integer i = 0; i < 4; i++) {
    children.add(new SSO_Data_Child__c(Name='SSO Child '+i, SSO_Parent__c=parents[i].Id));
}
insert children;
