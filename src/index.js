const path = require('path');
const fs = require('fs-extra');
const chokidar = require('chokidar');
const Testrail = require('testrail-api');

const testRailEnvironment = process.env.TESTRAIL_ENV || 'dev';
const config = require('../config')(testRailEnvironment);

const testRailAuthConfig = config.testRail.auth;
const projectFolderName = config.cuccumberProjectName;
const testRailProjectId = config.testRail.projectId;
const testRailSuiteId = config.testRail.suiteId;
let testRailRunId = config.testRail.runId;
const cuccumber_to_testrail_test_result_mapping = config.testRailStatusMapping;

const dotFeaturesFilePath = path.join(__dirname, '..', 'data', '.features.json');

const testReportFolderPath = path.join(__dirname, '..', '..', projectFolderName, 'report', 'IAM reports');
const jsonFileExtension = '.json';
const newLine = '\r\n';
const watchConfig = {
    ignored: /(^|[\/\\])\../
};

const featuresFileObject = require(dotFeaturesFilePath);

const testrail = new Testrail(testRailAuthConfig);

const isJsonFile = file => {
    return (path.extname(file) === jsonFileExtension);
};

const updateTestCaseStatusInTestRail = (testRailTestCaseId, steps) => {
    const testCaseStatus = steps.every( step => {
        return step['result']['status'] === 'passed';
    });
    let cuccumberTestCaseStatus = 'Failed';
    if(testCaseStatus){
        cuccumberTestCaseStatus = 'Passed';
    }
    const testRailTestCaseStatus = cuccumber_to_testrail_test_result_mapping[cuccumberTestCaseStatus];
    const testResult = {
        status_id: testRailTestCaseStatus
    };
    testrail.addResultForCase(testRailRunId, testRailTestCaseId, testResult)
        .then( result => {
            console.info('Add Result Success: ', JSON.stringify(result.body, null, 2));
        })
        .catch( error => {
            console.error('Add Result Error: ', error.message);
        });
};

const watcherErrorListener = error => console.error(`Watcher error: ${error}`);
const watcherReadyListener = () => console.info('Initial scan complete. Ready for changes');
const watcherAddListener = ( filePathName, stats ) => {
    console.info(`File ${filePathName} has been added`);
    if(isJsonFile(filePathName)){
        console.info('DO Further Add in TestRail');
        doUpdateTestRail(filePathName);
    }
};
const watcherChangeListener = ( filePathName, stats ) => {
    console.info(`File ${filePathName} has been changed`);
    if(isJsonFile(filePathName)){
        console.info('DO Further Update in TestRail');
        doUpdateTestRail(filePathName);
    }
};
const watcherUnlinkListener = ( filePathName, stats ) => {
    console.info(`File ${filePathName} has been changed`);
    if(isJsonFile(filePathName)){
        console.info('DO Further Delete in TestRail');

    }
};
const watcherAllListener = (eventType) => {
    console.dir('eventType: ', eventType);
};
const watcher = chokidar.watch(testReportFolderPath, watchConfig);
watcher
    .on('error', watcherErrorListener)
    .on('ready', watcherReadyListener)
    .on('add', watcherAddListener)
    .on('change', watcherChangeListener)
    .on('unlink', watcherUnlinkListener);

const doUpdateTestRail = (filePathName) => {
    const projectId = testRailProjectId;
    const suiteId = testRailSuiteId;

    const fileName = path.basename(filePathName, jsonFileExtension);
    const filePath = path.dirname(filePathName);
    console.info( `Reading the JSON File: "${fileName}" from Directory: "${filePath}"`);

    fs.readJson(path.join(testReportFolderPath, path.basename(filePathName)))
        .then(iamReportObjectsArray => {
            console.info('iamReportObjectsArray: ', JSON.stringify(iamReportObjectsArray, null, 2), iamReportObjectsArray[0]['elements'].length);
            iamReportObjectsArray.forEach( reportObject => {
                const reportSectionTitle = reportObject['name'];
                const allScenarios = reportObject['elements'];
                if(featuresFileObject['done'][reportSectionTitle]){
                    allScenarios.forEach( scenarioObject => {
                        const caseTitle = scenarioObject['name'];
                        let customSteps = [];
                        const allStepsOfTestCase = scenarioObject['steps'];
                        allStepsOfTestCase.forEach( stepObject => {
                            customSteps.push(stepObject['name']);
                        });
                        const caseContent = {
                            "title": caseTitle,
                            "suite_id": suiteId,
                            "custom_steps": customSteps.join(newLine)
                        };

                        const sectionId = featuresFileObject['done'][reportSectionTitle]['section_id'];
                        if(featuresFileObject['done'][reportSectionTitle][sectionId.toString()][caseTitle]){
                            const testRailCaseId = featuresFileObject['done'][reportSectionTitle][sectionId.toString()][caseTitle];
                            const caseIdNotAvailableMessage = 'Field :case_id is not a valid test case.';
                            testrail.getCase(testRailCaseId)
                                .then( result => {
                                    console.log("Already Existed Case in TestRail: ", result.body);
                                    // update the test case
                                    testrail.updateCase(testRailCaseId, caseContent)
                                        .then( result => {
                                            console.log("Already Existed Case Updated: ", result.body);
                                            console.info('featuresFileObject: ', JSON.stringify(featuresFileObject, null, 2));
                                            updateTestCaseStatusInTestRail(testRailCaseId, allStepsOfTestCase);
                                        })
                                        .catch( error => {
                                            console.log('Already Existed Case Updation Error: ', error.message);
                                        });
                                })
                                .catch( error => {
                                    console.log("Not Existed Case in TestRail: ", error.message.error===caseIdNotAvailableMessage);
                                    // add a test case
                                    testrail.addCase(sectionId, caseContent)
                                        .then(function (result) {
                                            console.log("Not Existed in TestRail Case Created: ", result.body);
                                            const testRailCaseId = result.body.id;
                                            featuresFileObject['done'][reportSectionTitle][sectionId.toString()][caseTitle] = testRailCaseId;
                                            console.info('featuresFileObject: ', JSON.stringify(featuresFileObject, null, 2));
                                            fs.writeJsonSync(dotFeaturesFilePath, featuresFileObject);
                                            updateTestCaseStatusInTestRail(testRailCaseId, allStepsOfTestCase);
                                        })
                                        .catch(function (error) {
                                            console.log('Not Existed in TestRail Case Creation Error: ', error.message);
                                        });
                                });
                        }else{
                            // add a test case
                            testrail.addCase(sectionId, caseContent)
                                .then(function (result) {
                                    console.log("Case Created: ", result.body);
                                    const testRailCaseId = result.body.id;
                                    featuresFileObject['done'][reportSectionTitle][sectionId.toString()][caseTitle] = testRailCaseId;
                                    console.info('featuresFileObject: ', JSON.stringify(featuresFileObject, null, 2));
                                    fs.writeJsonSync(dotFeaturesFilePath, featuresFileObject);
                                    updateTestCaseStatusInTestRail(testRailCaseId, allStepsOfTestCase);
                                })
                                .catch(function (error) {
                                    console.log('Case Creation Error: ', error.message);
                                });
                        }
                    });
                } else {
                    const sectionContent = {
                        "name": reportSectionTitle,
                        "suite_id": suiteId
                    };
                    testrail.addSection(projectId, sectionContent)
                        .then( result => {
                            const sectionId = result.body.id;
                            featuresFileObject['done'][reportSectionTitle] = {
                                "section_id": sectionId,
                                [sectionId.toString()]: {

                                }
                            };
                            fs.writeJsonSync(dotFeaturesFilePath, featuresFileObject);
                            allScenarios.forEach( scenarioObject => {
                                const caseTitle = scenarioObject['name'];
                                let customSteps = [];
                                const allStepsOfTestCase = scenarioObject['steps'];
                                allStepsOfTestCase.forEach( stepObject => {
                                    customSteps.push(stepObject['name']);
                                });
                                const caseContent = {
                                    "title": caseTitle,
                                    "suite_id": suiteId,
                                    "custom_steps": customSteps.join(newLine)
                                };
                                if(featuresFileObject['done'][reportSectionTitle][sectionId.toString()][caseTitle]){
                                    const testRailCaseId = featuresFileObject['done'][reportSectionTitle][sectionId.toString()][caseTitle];
                                    const caseIdNotAvailableMessage = 'Field :case_id is not a valid test case.';
                                    testrail.getCase(testRailCaseId)
                                        .then( result => {
                                            console.log("Already Existed Case in TestRail: ", result.body);
                                            // update the test case
                                            testrail.updateCase(testRailCaseId, caseContent)
                                                .then( result => {
                                                    console.log("Already Existed Case Updated: ", result.body);
                                                    console.info('featuresFileObject: ', JSON.stringify(featuresFileObject, null, 2));
                                                    updateTestCaseStatusInTestRail(testRailCaseId, allStepsOfTestCase);
                                                })
                                                .catch( error => {
                                                    console.log('Already Existed Case Updation Error: ', error.message);
                                                });
                                        })
                                        .catch( error => {
                                            console.log("Not Existed Case in TestRail: ", error.message.error===caseIdNotAvailableMessage);
                                            // add a test case
                                            testrail.addCase(sectionId, caseContent)
                                                .then(function (result) {
                                                    console.log("Not Existed in TestRail Case Created: ", result.body);
                                                    const testRailCaseId = result.body.id;
                                                    featuresFileObject['done'][reportSectionTitle][sectionId.toString()][caseTitle] = testRailCaseId;
                                                    console.info('featuresFileObject: ', JSON.stringify(featuresFileObject, null, 2));
                                                    fs.writeJsonSync(dotFeaturesFilePath, featuresFileObject);
                                                    updateTestCaseStatusInTestRail(testRailCaseId, allStepsOfTestCase);
                                                })
                                                .catch(function (error) {
                                                    console.log('Not Existed in TestRail Case Creation Error: ', error.message);
                                                });
                                        });
                                }else{
                                    // add a test case
                                    testrail.addCase(sectionId, caseContent)
                                        .then(function (result) {
                                            console.log("Case Created: ", result.body);
                                            const testRailCaseId = result.body.id;
                                            featuresFileObject['done'][reportSectionTitle][sectionId.toString()][caseTitle] = testRailCaseId;
                                            console.info('featuresFileObject: ', JSON.stringify(featuresFileObject, null, 2));
                                            fs.writeJsonSync(dotFeaturesFilePath, featuresFileObject);
                                            updateTestCaseStatusInTestRail(testRailCaseId, allStepsOfTestCase);
                                        })
                                        .catch(function (error) {
                                            console.log('Case Creation Error: ', error.message);
                                        });
                                }
                            });
                        })
                        .catch( error => {
                            console.log('Add Section Error: ', error.stack);
                        });
                }
            });
        })
        .catch( err => {
            console.error(err.stack);
        });
};

const createTestRunInTestRail = () => {
    const projectId = testRailProjectId;
    const suiteId = testRailSuiteId;
    /*const runContent = {
        "project_id": projectId,
        "suite_id": suiteId,
        "plan_id": 'planId'
        "name": 'runName'
    };*/
    // const runContent = {};
    const runContent = {
        "project_id": projectId,
        "suite_id": suiteId,
        "name": 'runName'
    };
    testrail.addRun(projectId, runContent)
        .then( result => {
            console.info('Add Run success: ', JSON.stringify(result.body, null, 2));
            testRailRunId = result.body.id;
        })
        .catch( error => {
            console.error('Add Run error: ', error.stack);
        });
};