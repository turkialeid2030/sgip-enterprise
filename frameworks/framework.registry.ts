/**
 * Framework Registry — operational metadata for all supported frameworks.
 * These are runtime objects, not documentation.
 */
import { Framework, FrameworkId } from "./framework.types";

export const FRAMEWORK_REGISTRY: Record<FrameworkId, Framework> = {
  CRISC:      { id:"CRISC",      name:"CRISC — Certified in Risk and Information Systems Control", version:"2022", issuer:"ISACA",  domains:["risk","governance","technology","audit"],                                      controlCount:4,   applicability:["all"],                       mandatoryFor:[],                         lastUpdated:"2022-01-01", description:"Risk management framework focusing on IS risk governance",            maturityModel:false, certifiable:true  },
  COBIT_2019: { id:"COBIT_2019", name:"COBIT 2019",                                               version:"2019", issuer:"ISACA",  domains:["governance","risk","compliance","audit","technology"],                         controlCount:40,  applicability:["all"],                       mandatoryFor:[],                         lastUpdated:"2019-01-01", description:"IT governance and management framework",                              maturityModel:true,  certifiable:false },
  ISO_27001:  { id:"ISO_27001",  name:"ISO/IEC 27001:2022",                                       version:"2022", issuer:"ISO",    domains:["security","governance","risk","compliance","technology"],                      controlCount:93,  applicability:["all"],                       mandatoryFor:["NCA_ECC","SAMA_CSF"],     lastUpdated:"2022-10-25", description:"Information security management systems",                             maturityModel:false, certifiable:true  },
  NCA_ECC:    { id:"NCA_ECC",    name:"NCA Essential Cybersecurity Controls",                     version:"2023", issuer:"NCA",    domains:["security","technology","governance","compliance"],                              controlCount:21,  applicability:["Saudi Arabia"],              mandatoryFor:["Saudi Arabia"],           lastUpdated:"2023-01-01", description:"Saudi National Cybersecurity Authority baseline controls",            maturityModel:true,  certifiable:false },
  HIPAA:      { id:"HIPAA",      name:"HIPAA Security Rule",                                      version:"2013", issuer:"HHS",    domains:["privacy","security","compliance","data"],                                       controlCount:75,  applicability:["Healthcare","US"],            mandatoryFor:["US Healthcare"],          lastUpdated:"2013-01-25", description:"US Health Insurance Portability and Accountability Act",              maturityModel:false, certifiable:false },
  PCI_DSS:    { id:"PCI_DSS",    name:"PCI DSS v4.0",                                             version:"4.0",  issuer:"PCI SSC",domains:["security","compliance","financial","technology","data"],                        controlCount:264, applicability:["Payment Processing"],        mandatoryFor:["Payment Processing"],     lastUpdated:"2022-03-31", description:"Payment Card Industry Data Security Standard",                       maturityModel:false, certifiable:true  },
  GDPR:       { id:"GDPR",       name:"EU General Data Protection Regulation",                    version:"2018", issuer:"EU",     domains:["privacy","compliance","data","governance"],                                     controlCount:99,  applicability:["EU","EEA","global_eu_data"],  mandatoryFor:["EU Operations"],          lastUpdated:"2018-05-25", description:"EU regulation on data protection and privacy",                        maturityModel:false, certifiable:false },
  ISO_27701:  { id:"ISO_27701",  name:"ISO/IEC 27701:2019",                                       version:"2019", issuer:"ISO",    domains:["privacy","data","governance","compliance"],                                     controlCount:49,  applicability:["all"],                       mandatoryFor:[],                         lastUpdated:"2019-08-06", description:"Privacy information management system extension to ISO 27001",        maturityModel:false, certifiable:true  },
  ISO_22301:  { id:"ISO_22301",  name:"ISO 22301:2019",                                           version:"2019", issuer:"ISO",    domains:["continuity","governance","risk","operational"],                                 controlCount:37,  applicability:["all"],                       mandatoryFor:[],                         lastUpdated:"2019-10-31", description:"Business continuity management systems",                              maturityModel:false, certifiable:true  },
  NIST_CSF:   { id:"NIST_CSF",   name:"NIST Cybersecurity Framework 2.0",                         version:"2.0",  issuer:"NIST",   domains:["security","governance","risk","technology"],                                    controlCount:106, applicability:["US Federal","Critical Infrastructure"], mandatoryFor:["US Federal"], lastUpdated:"2024-02-26", description:"NIST Framework for Improving Critical Infrastructure Cybersecurity", maturityModel:true,  certifiable:false },
  SOX:        { id:"SOX",        name:"Sarbanes-Oxley Act",                                       version:"2002", issuer:"US SEC", domains:["financial","governance","compliance","audit"],                                  controlCount:58,  applicability:["US Listed Companies"],       mandatoryFor:["US Listed Companies"],    lastUpdated:"2002-07-30", description:"US financial reporting and internal control requirements",            maturityModel:false, certifiable:false },
  COSO_ERM:   { id:"COSO_ERM",   name:"COSO Enterprise Risk Management 2017",                     version:"2017", issuer:"COSO",   domains:["risk","governance","strategy","operational"],                                   controlCount:20,  applicability:["all"],                       mandatoryFor:[],                         lastUpdated:"2017-09-01", description:"Integrated framework for enterprise risk management",                 maturityModel:true,  certifiable:false },
  ISMS_PDPL:  { id:"ISMS_PDPL",  name:"Saudi Personal Data Protection Law",                       version:"2021", issuer:"SDAIA", domains:["privacy","compliance","data","governance"],                                      controlCount:35,  applicability:["Saudi Arabia"],              mandatoryFor:["Saudi Arabia"],           lastUpdated:"2021-09-24", description:"Saudi Arabia Personal Data Protection Law requirements",             maturityModel:false, certifiable:false },
  SAMA_CSF:   { id:"SAMA_CSF",   name:"SAMA Cybersecurity Framework",                             version:"1.0",  issuer:"SAMA",   domains:["security","compliance","governance","technology","risk"],                       controlCount:140, applicability:["Saudi Financial Sector"],    mandatoryFor:["Saudi Financial Sector"], lastUpdated:"2017-05-01", description:"Saudi Central Bank cybersecurity framework for financial sector",     maturityModel:true,  certifiable:false },
};

export function getFramework(id: FrameworkId): Framework {
  return FRAMEWORK_REGISTRY[id];
}

export function getFrameworksByDomain(domain: Framework["domains"][0]): Framework[] {
  return Object.values(FRAMEWORK_REGISTRY).filter(f => f.domains.includes(domain));
}

export function getMandatoryFrameworks(jurisdiction: string): Framework[] {
  return Object.values(FRAMEWORK_REGISTRY).filter(f =>
    f.mandatoryFor.some(m => jurisdiction.toLowerCase().includes(m.toLowerCase()))
  );
}

export function getCertifiableFrameworks(): Framework[] {
  return Object.values(FRAMEWORK_REGISTRY).filter(f => f.certifiable);
}

export const ALL_FRAMEWORK_IDS = Object.keys(FRAMEWORK_REGISTRY) as FrameworkId[];
