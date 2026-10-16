/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
@IsTest
private with sharing class SSO_AepFixtureTest {
    @IsTest static void actionSetsStatus() {
        SSO_Aep_Case__c record = new SSO_Aep_Case__c(Name = 'Unit smoke');
        SSO_AepSetStatusAction action = new SSO_AepSetStatusAction();
        action.setRecordsToActOn(new List<SObject>{record});
        action.runInProcess();
        System.assertEquals('Injected', record.SSO_Status__c);
        System.assertEquals('pong', new SSO_AepServiceImpl().ping());
        System.assertEquals(SSO_Aep_Case__c.SObjectType, new SSO_AepCasesSelector().getSObjectType());
        System.assertNotEquals(null, new SSO_AepCases.Constructor().construct(new List<SObject>{record}));
    }
    @IsTest static void untriggeredDomainConstructs() {
        SSO_Aep_Untriggered__c record = new SSO_Aep_Untriggered__c(Name = 'Untriggered smoke');
        fflib_SObjectDomain domain = new SSO_AepUntriggereds.Constructor().construct(new List<SObject>{record});
        System.assert(domain instanceof ISSO_AepUntriggereds);
        System.assertEquals(new List<SObject>{record}, domain.getRecords());
    }
}
