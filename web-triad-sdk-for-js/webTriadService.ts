class WebTriadService {
    private self = this;
    private fileApiUrl = "/files";
    private dicomViewerUrl = "/dicomViewerUrl";
    private nonDicomsUrl = "/nonDicoms";
    private submissionFileInfoApiUrl = "/submissionPackages";
    private submittedSeriesDetailsUrl = "/series";
    private submittedStudiesDetailsUrl = "/studies";
    private submittedFilesDetailsUrl = "/submittedPackageFiles";
    private settings: IServiceSettings;
    private listsOfFiles: { [id: string]: ListOfFilesForUpload };
    private securityToken: string = null;

    //////////////////////////////////////////////////////////////////////////

    /**
     * Initialize Web TRIAD Client
     * @param {IServiceSettings} serviceSettings
     */
    constructor(serviceSettings: IServiceSettings) {
        this.settings = $.extend({
            serverApiUrl: "http://cuv-triad-app.restonuat.local/api",
            numberOfFilesInPackage: 4,
            sizeChunk: 1024 * 1024 * 2,
            numberOfConnection: 6,
            dicomsDisabled: false,
            nonDicomsDisabled: false
        }, serviceSettings);
        const serverApiUrl = this.settings.serverApiUrl;
        this.fileApiUrl = serverApiUrl + this.fileApiUrl;
        this.submissionFileInfoApiUrl = serverApiUrl + this.submissionFileInfoApiUrl;
        this.submittedStudiesDetailsUrl = serverApiUrl + this.submittedStudiesDetailsUrl;
        this.submittedSeriesDetailsUrl = serverApiUrl + this.submittedSeriesDetailsUrl;
        this.submittedFilesDetailsUrl = serverApiUrl + this.submittedFilesDetailsUrl;
        this.dicomViewerUrl = serverApiUrl + this.dicomViewerUrl;
        this.nonDicomsUrl = serverApiUrl + this.nonDicomsUrl;
        this.listsOfFiles = {};
    }

    ////////////////////////////////////////////

    /**
     * Sends files to Web TRIAD
     * @param {IFileExt[]} files
     * @param {ItemData[]} metadata
     * @param {(progressData: SubmissionProgressData) => void} uploadAndSubmitListOfFilesProgress
     * @returns {string}
     */
    submitFiles(files: IFileExt[], metadata: ItemData[], uploadAndSubmitListOfFilesProgress: (progressData: SubmissionProgressData) => void) {
        const id = this.addListOfFilesForUpload(files);
        this.uploadAndSubmitListOfFiles(id, metadata, uploadAndSubmitListOfFilesProgress);
        return id;
    }

    ////////////////////////////////////////////

    addListOfFilesForUpload(files: IFileExt[]): string {
        const listOfFilesId = this.getGuid();
        this.listsOfFiles[listOfFilesId] = {
            submissionPackageId: null,
            deferredCreatingSubmissionPackage: $.Deferred(),
            files: [],
            size: 0,
            isCanceled: false,
            defferedSubmits: {}
        };
        if (files.length > 0) {
            let sizeOfFiles = 0;
            for (let i = 0; i < files.length; i++) {
                files[i].listOfFilesId = listOfFilesId;
                this.setFileStatus(files[i], FileStatus.Ready);
                this.listsOfFiles[listOfFilesId].files.push(files[i]);
                sizeOfFiles += files[i].size;
            }
            this.listsOfFiles[listOfFilesId].size = sizeOfFiles;
        }
        return listOfFilesId;
    }

    ////////////////////////////////////////////

    uploadAndSubmitListOfFiles(listOfFilesId: string, metadata: ItemData[], uploadAndSubmitListOfFilesProgress: (progressData: SubmissionProgressData) => void) {
        var self = this;
        var listOfFiles = self.listsOfFiles[listOfFilesId];

        var startFileNumberInPackage = 0;
        var finishFileNumberInPackage = 0;
        var numberOfUploadedBytes = 0;

        var currentPackage = new PackageOfFilesForUpload();
        currentPackage.id = self.getGuid();
        var progressData = new SubmissionProgressData();

        const initialSubmissionPackageResource = {
            DicomsDisabled: self.settings.dicomsDisabled,
            NonDicomsDisabled: self.settings.nonDicomsDisabled,
            Metadata: metadata
        }

        self.createSubmissionPackage(initialSubmissionPackageResource, createSubmissionPackageProgress);

        function createSubmissionPackageProgress(data: SubmissionProgressData) {
            if (data.processStatus === ProcessStatus.Error) {
                uploadAndSubmitListOfFilesProgress(data);
                return;
            }
            listOfFiles.submissionPackageId = data.submissionPackage.Id;
            listOfFiles.deferredCreatingSubmissionPackage.resolve().promise();
            processingNextPackage();
        }

        function processingNextPackage() {
            currentPackage.files = getNextFilesForPackage();

            if (currentPackage.files.length === 0) return;

            currentPackage.numberOfFiles = currentPackage.files.length;
            currentPackage.numberOfUploadedFiles = 0;
            currentPackage.urisOfUploadedFiles = [];

            uploadNextFileFromPackage();
        }

        function uploadNextFileFromPackage() {
            if (listOfFiles.isCanceled) return;
            const file = currentPackage.files.splice(0, 1)[0];
            self.uploadFile(file, uploadFileProgress);
        }

        function getNextFilesForPackage() {
            startFileNumberInPackage = finishFileNumberInPackage;
            finishFileNumberInPackage += self.settings.numberOfFilesInPackage;
            return listOfFiles.files.slice(startFileNumberInPackage, finishFileNumberInPackage);
        }

        function uploadFileProgress(uploadData: FileProgressData) {
            progressData.processStep = ProcessStep.Uploading;
            switch (uploadData.processStatus) {
                case ProcessStatus.Success:
                    if (listOfFiles.isCanceled) {
                        progressData.processStep = ProcessStep.Canceling;
                        progressData.statusCode = uploadData.statusCode;
                        progressData.details = uploadData.details;
                        progressData.message = uploadData.message;
                        progressData.processStatus = ProcessStatus.Success;                     
                        progressData.message = "CancelSubmit";
                        progressData.progress = 0;
                        progressData.progressBytes = 0;
                        uploadAndSubmitListOfFilesProgress(progressData);
                        return;
                    }
                    numberOfUploadedBytes += uploadData.currentUploadedChunkSize;
                    progressData.statusCode = uploadData.statusCode;
                    progressData.processStatus = ProcessStatus.InProgress;
                    progressData.details = uploadData.details;
                    progressData.message = uploadData.message;
                    progressData.progress = Math.ceil(numberOfUploadedBytes / listOfFiles.size * 100);
                    progressData.progressBytes = numberOfUploadedBytes;

                    currentPackage.urisOfUploadedFiles.push(uploadData.fileUri);
                    currentPackage.numberOfUploadedFiles++;
                    if (currentPackage.numberOfUploadedFiles === currentPackage.numberOfFiles) {

                        const parameters = currentPackage.urisOfUploadedFiles;

                        listOfFiles.defferedSubmits[currentPackage.id] = $.Deferred();

                        self.addDicomFilesToExistingSubmissionPackage(listOfFiles.submissionPackageId, parameters, addDicomFilesProgress);
                        for (let file of listOfFiles.files) {
                            if (parameters.indexOf(file.uri) > -1) file.isAttached = true;
                        }
                        return;
                    }
                    uploadAndSubmitListOfFilesProgress(progressData);
                    uploadNextFileFromPackage();
                    break;
                case ProcessStatus.InProgress:
                    numberOfUploadedBytes += uploadData.currentUploadedChunkSize;
                    progressData.statusCode = uploadData.statusCode;
                    progressData.processStatus = ProcessStatus.InProgress;
                    progressData.details = uploadData.details;
                    progressData.message = uploadData.message;
                    progressData.progress = Math.ceil(numberOfUploadedBytes / listOfFiles.size * 100);
                    progressData.progressBytes = numberOfUploadedBytes;

                    uploadAndSubmitListOfFilesProgress(progressData);
                    break;

                case ProcessStatus.Error:
                    progressData.statusCode = uploadData.statusCode;
                    progressData.statusText = uploadData.statusText;
                    progressData.processStatus = ProcessStatus.Error;
                    progressData.details = uploadData.details;
                    progressData.message = uploadData.message;
                    
                    uploadAndSubmitListOfFilesProgress(progressData);
                    break;
            }
        }
        function addDicomFilesProgress(data: SubmissionProgressData) {
            listOfFiles.defferedSubmits[currentPackage.id].resolve().promise();
            progressData.processStep = ProcessStep.Uploading;
            progressData.statusCode = data.statusCode;

            switch (data.processStatus) {
                case ProcessStatus.Success:
                    if (finishFileNumberInPackage < listOfFiles.files.length) {
                        progressData.processStatus = ProcessStatus.InProgress;
                        progressData.message = "InProgress";
                        uploadAndSubmitListOfFilesProgress(progressData);
                        processingNextPackage();
                        return;
                    }                   
                    progressData.processStatus = ProcessStatus.Success;
                    progressData.message = "Success";
                    uploadAndSubmitListOfFilesProgress(progressData);

                    self.submitSubmissionPackage(listOfFiles.submissionPackageId, uploadAndSubmitListOfFilesProgress);
                    break;
                case ProcessStatus.Error:
                    progressData.processStatus = ProcessStatus.Error;
                    progressData.message = "Error";
                    uploadAndSubmitListOfFilesProgress(progressData);
                    break;
                default:
            }
        }
    }

    ////////////////////////////

    createSubmissionPackage(parameters: InitialSubmissionPackageResource, submitFilesProgress: (progressData: SubmissionProgressData) => void) {
        var self = this;
        var progressData = new SubmissionProgressData();
        progressData.processStep = ProcessStep.Uploading;
        $.ajax({
            url: this.submissionFileInfoApiUrl,
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr) {
                progressData.statusCode = jqXhr.status;
                progressData.statusText = jqXhr.statusText;
                progressData.processStatus = ProcessStatus.Error;
                progressData.message = "Error createSubmissionPackage";
                progressData.details = jqXhr.responseText;
                submitFilesProgress(progressData);
            },
            success(result, textStatus, jqXhr) {
                progressData.statusCode = jqXhr.status;
                progressData.processStatus = ProcessStatus.Success;
                progressData.message = "Success createSubmissionPackage";
                progressData.submissionPackage = result;
                submitFilesProgress(progressData);
            }
        });
    }

    ////////////////////////////

    addDicomFilesToExistingSubmissionPackage(uri: string, parameters: string[], addDicomFilesProgress: (progressData: SubmissionProgressData) => void) {
        var self = this;
        var progressData = new SubmissionProgressData();
        progressData.processStep = ProcessStep.Uploading;
        var filesUris = [];
        for (let uri of parameters) filesUris.push({ Id: uri });

        $.ajax({
            url: this.submissionFileInfoApiUrl + "/" + uri + "/files",
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(filesUris),
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr) {
                progressData.processStatus = ProcessStatus.Error;
                progressData.message = "Error additionalSubmit";
                progressData.details = jqXhr.responseText;
                progressData.statusCode = jqXhr.status;
                progressData.statusText = jqXhr.statusText;
                addDicomFilesProgress(progressData);
            },
            success(result, textStatus, jqXhr) {               
                progressData.statusCode = jqXhr.status;
                progressData.processStatus = ProcessStatus.Success;
                progressData.message = "Success additionalSubmit";
                addDicomFilesProgress(progressData);
            }
        });
    }

    ////////////////////////////

    submitSubmissionPackage(uri: string, submissionProgress: (progressData: SubmissionProgressData) => void) {
        var self = this;
        let progressData = new SubmissionProgressData();
        progressData.processStep = ProcessStep.Processing;
        $.ajax({
            url: this.submissionFileInfoApiUrl + "/" + uri + "/submit",
            type: "POST",
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr, textStatus, errorThrown) {
                progressData.processStatus = ProcessStatus.Error;
                progressData.message = "Error submitSubmissionPackage";
                progressData.details = jqXhr.responseText;
                progressData.statusText = jqXhr.statusText;
                progressData.statusCode = jqXhr.status;
                submissionProgress(progressData);
            },
            success(result, text, jqXhr) {
                progressData.processStatus = ProcessStatus.InProgress;
                progressData.statusCode = jqXhr.status;
                submissionProgress(progressData);
                self.waitForProcessingStudiesByServer(uri, submissionProgress);
            }
        });
    }

    //////////////////////////////Waiting for processing the studies by the server

    waitForProcessingStudiesByServer(uri: string, submissionProgress: (progressData: SubmissionProgressData) => void) {
        var self = this;
        var rejectedAndCorruptedData;
        
        getSubmissionPackage(uri, callback);

        function getSubmissionPackage(uri: string, getSubmissionPackageProgress: (progressData: SubmissionProgressData) => void) {
            let progressData = new SubmissionProgressData();
            progressData.processStep = ProcessStep.Processing;
            $.ajax({
                url: self.submissionFileInfoApiUrl + "/" + uri,
                type: "GET",
                dataType: "json",
                beforeSend(xhr) {
                    xhr.setRequestHeader("Authorization", self.securityToken);
                },
                error(jqXhr, textStatus, errorThrown) {
                    progressData.processStatus = ProcessStatus.Error;
                    progressData.statusCode = jqXhr.status;
                    progressData.statusText = jqXhr.statusText;
                    progressData.message = "Error getSubmissionPackage";
                    progressData.details = jqXhr.responseText;
                    getSubmissionPackageProgress(progressData);
                },
                success(result, text, jqXhr) {
                    progressData.processStatus = ProcessStatus.Success;
                    progressData.statusCode = jqXhr.status;
                    progressData.additionalData = result;
                    getSubmissionPackageProgress(progressData);
                }
            });
        }

        function callback(progressData: SubmissionProgressData) {
            switch (progressData.processStatus) {
            case ProcessStatus.Error:
                    submissionProgress(progressData);
                    break;
            case ProcessStatus.Success:
                    switch (getSubmissionStatus(progressData.additionalData)) {
                        case SubmissionPackageStatus.Failed:
                            progressData.processStatus = ProcessStatus.Error;
                            progressData.message = "Processing submission package failed";
                            break;
                        case SubmissionPackageStatus.Submitting:
                            setTimeout(() => { getSubmissionPackage(uri, callback) }, 3000);
                            break;
                        case SubmissionPackageStatus.Complete:
                            rejectedAndCorruptedData = prepareRejectedAndCorruptedData(progressData.additionalData);
                            progressData.rejectedAndCorruptedData = rejectedAndCorruptedData;
                            submissionProgress(progressData);
                            break;
                }
                    break;
            }
        };

        function getSubmissionStatus(data) {
            if (data.Status === "Failed") return SubmissionPackageStatus.Failed;
            if (data.Status !== "Complete") return SubmissionPackageStatus.Submitting;
            for (let i = 0; i < data.Submissions.length; i++) {
                if (data.Submissions[i].Status === "None" ||
                    data.Submissions[i].Status === "InProgress" ||
                    data.Submissions[i].Status === "NotStarted") {
                    return SubmissionPackageStatus.Submitting;
                }
            }
            return SubmissionPackageStatus.Complete;
        };

        function prepareRejectedAndCorruptedData(data) {
            return {
                NumberOfCorruptedDicoms: data.DicomSummary.CorruptedCount,
                NumberOfRejectedDicoms: data.DicomSummary.RejectedCount,
                NumberOfDuplicateDicoms: data.DicomSummary.DuplicateCount,
                NumberOfRejectedNonDicoms: data.NonDicomsSummary.RejectedCount,
                NumberOfRejectedDicomDir: data.DicomDirSummary.RejectedCount,
                CorruptedDicoms: data.DicomSummary.Corrupted,
                RejectedDicoms: data.DicomSummary.Rejected,
                DuplicateDicoms: data.DicomSummary.Duplicates,
                RejectedNonDicoms: data.NonDicomsSummary.Rejected
            };
        };
    }

    //////////////////////////////



    //////////////////////////////

    cancelUploadAndSubmitListOfFiles(listOfFilesId: string,
        cancelSubmitProgress: (progressData: SubmissionProgressData) => void) {
        const self = this;
        var listOfFiles = self.listsOfFiles[listOfFilesId];
        listOfFiles.isCanceled = true;
        var progressData = new SubmissionProgressData();
        progressData.processStep = ProcessStep.Canceling;


        $.when(listOfFiles.deferredCreatingSubmissionPackage).done(() => {

            var defs = [];
            for (let def in listOfFiles.defferedSubmits) {
                if (listOfFiles.defferedSubmits.hasOwnProperty(def)) {
                    defs.push(listOfFiles.defferedSubmits[def]);
                }
            }

            $.when.apply($, defs).done(() => {
                $.ajax({
                    url: this.submissionFileInfoApiUrl + "/" + listOfFiles.submissionPackageId,
                    type: "DELETE",
                    beforeSend(xhr) {
                        xhr.setRequestHeader("Authorization", self.securityToken);
                    },
                    error(jqXhr, textStatus, errorThrown) {
                        progressData.processStatus = ProcessStatus.Error;
                        progressData.statusCode = jqXhr.status;
                        progressData.statusText = jqXhr.statusText;
                        progressData.message = "Error cancelUploadAndSubmitListOfFiles";
                        progressData.details = jqXhr.responseText;
                        cancelSubmitProgress(progressData);
                    },
                    success(result, textStatus, jqXhr) {
                        progressData.processStatus = ProcessStatus.Success;
                        progressData.statusCode = jqXhr.status;
                        progressData.message = "Success cancelUploadAndSubmitListOfFiles";
                        cancelSubmitProgress(progressData);
                    }
                });
                for (let i = 0; i < listOfFiles.files.length; i++) {
                    if (!listOfFiles.files[i].isAttached && listOfFiles.files[i].status !== FileStatus.Ready) {
                        listOfFiles.files[i].status = FileStatus.Canceling;
                        listOfFiles.files[i].cancelUploadFileProgress = cancelSubmitProgress;
                        if (listOfFiles.files[i] !== undefined) this.deleteFileFromStage(listOfFiles.files[i]);
                    }
                }
            });
        });
    }

    /////////////////////////////////////////

    getStudiesDetails(parameters: any, callback: (data: ReviewProgressData) => void) {
        var self = this;
        parameters = this.arrayOfNameValueToDictionary(parameters);
        let progressData = new ReviewProgressData();
        progressData.processStep = ReviewProcessStep.GettingStudies;
        $.ajax({
            url: this.submittedStudiesDetailsUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: "json",
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr, textStatus, errorThrown) {               
                progressData.processStatus = ProcessStatus.Error;
                progressData.statusCode = jqXhr.status;
                progressData.statusText = jqXhr.statusText;
                progressData.message = "Error getStudiesDetails()";
                progressData.details = jqXhr.responseText;
                callback(progressData);
            },
            success(data, textStatus, jqXhr) {
                progressData.processStatus = ProcessStatus.Success;
                progressData.data = data;
                callback(progressData);
            }
        });
    }

    ////////////////////////////

    deleteStudy(deleteUrl: string, callback: (data: ReviewProgressData) => void) {
        var self = this;

        var url = self.settings.serverApiUrl;
        if (deleteUrl.indexOf("/api/") > -1) {
            url = self.settings.serverApiUrl.replace("/api", "");
        }

        let progressData = new ReviewProgressData();
        progressData.processStep = ReviewProcessStep.DeletingStudies;

        $.ajax({
            url: url + deleteUrl,
            type: "DELETE",
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr, textStatus, errorThrown) {
                progressData.processStatus = ProcessStatus.Error;
                progressData.statusCode = jqXhr.status;
                progressData.statusText = jqXhr.statusText;
                progressData.message = "Error deleteStudy()";
                progressData.details = jqXhr.responseText;               
                callback(progressData);
            },
            success(result, textStatus, jqXhr) {
                progressData.processStatus = ProcessStatus.Success;
                callback(progressData);
            }
        });
    }

    ///////////////////////////

    deleteSeries(deleteUrl: string, callback: (data: ReviewProgressData) => void) {
        var self = this;

        var url = self.settings.serverApiUrl;
        if (deleteUrl.indexOf("/api/") > -1) {
            url = self.settings.serverApiUrl.replace("/api", "");
        }

        let progressData = new ReviewProgressData();
        progressData.processStep = ReviewProcessStep.DeletingSeries;
        $.ajax({
            url: url + deleteUrl,
            type: "DELETE",
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr, textStatus, errorThrown) {
                progressData.processStatus = ProcessStatus.Error;
                progressData.statusCode = jqXhr.status;
                progressData.statusText = jqXhr.statusText;
                progressData.message = "Error deleteSeries()";
                progressData.details = jqXhr.responseText;  
                callback(progressData);
            },
            success(result, textStatus, jqXhr) {
                progressData.processStatus = ProcessStatus.Success;
                callback(progressData);
            }
        });
    }

    ////////////////////////////

    deleteNonDicom(deleteUrl: string, callback: (data: ReviewProgressData) => void) {
        var self = this;

        var url = self.settings.serverApiUrl;
        if (deleteUrl.indexOf("/api/") > -1) {
            url = self.settings.serverApiUrl.replace("/api", "");
        }

        let progressData = new ReviewProgressData();
        progressData.processStep = ReviewProcessStep.DeletingNonDicomFiles;
        $.ajax({
            url: url + deleteUrl,
            type: "DELETE",
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr, textStatus, errorThrown) {
                progressData.processStatus = ProcessStatus.Error;
                progressData.statusCode = jqXhr.status;
                progressData.statusText = jqXhr.statusText;
                progressData.message = "Error deleteNonDicom()";
                progressData.details = jqXhr.responseText;               
                callback(progressData);
            },
            success(result, textStatus, jqXhr) {
                progressData.processStatus = ProcessStatus.Success;
                callback(progressData);
            }
        });
    }

    ///////////////////////////

    deleteNonDicoms(ids: string[], callback: (data: ReviewProgressData) => void) {
        var self = this;

        let arr = splitArray(ids, 300);

        for (let batch of arr) {
            let idsStr = batch.join();
            let progressData = new ReviewProgressData();
            progressData.processStep = ReviewProcessStep.DeletingNonDicomFiles;
            $.ajax({
                url: self.nonDicomsUrl + "?ids=" + idsStr,
                type: "DELETE",
                beforeSend(xhr) {
                    xhr.setRequestHeader("Authorization", self.securityToken);
                },
                error(jqXhr, textStatus, errorThrown) {
                    progressData.processStatus = ProcessStatus.Error;
                    progressData.statusCode = jqXhr.status;
                    progressData.statusText = jqXhr.statusText;
                    progressData.message = "Error deleteNonDicoms()";
                    progressData.details = jqXhr.responseText;                      
                    callback(progressData);
                },
                success(result, textStatus, jqXhr) {
                    progressData.processStatus = ProcessStatus.Success;
                    callback(progressData);
                }
            });
        };

        function splitArray(arr: any[], size: number) {
            let obj = [];
            let start = 0;
            let end = size;
            do {
                obj.push(arr.slice(start, end));
                start = end;
                end += size;
            } while (start < arr.length)
            return obj;
        };
    }

    ///////////////////////////

    setSecurityToken(token: string) {
        this.securityToken = token;
    }

    /////////////////////////////////////////

    getNonDicomsDetails(parameters: any, callback: (data: ReviewProgressData) => void) {
        var self = this;
        parameters = this.arrayOfNameValueToDictionary(parameters);
        let progressData = new ReviewProgressData();
        progressData.processStep = ReviewProcessStep.GettingNonDicomFiles;
        $.ajax({
            url: this.nonDicomsUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: "json",
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr, textStatus, errorThrown) {               
                progressData.processStatus = ProcessStatus.Error;
                progressData.statusCode = jqXhr.status;
                progressData.statusText = jqXhr.statusText;
                progressData.message = "Error getNonDicomsDetails()";
                progressData.details = jqXhr.responseText;
                callback(progressData);
            },
            success(data, textStatus, jqXhr) {
                progressData.processStatus = ProcessStatus.Success;
                progressData.data = data;
                callback(progressData);
            }
        });
    }

    ////////////////////////////openViewer() is not used

    openViewer(parameters: any, callback: (data: any) => void) {
        var self = this;
        let data: any = {};
        $.ajax({
            url: this.dicomViewerUrl,
            type: "PUT",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr, textStatus, errorThrown) {

                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success(result, textStatus, jqXhr) {
                const url = jqXhr.getResponseHeader("Location");
                var newwindow = window.open(url, 'temp window to test Claron integration', 'left=(screen.width/2)-400,top=(screen.height/2) - 180,width=800,height=360,toolbar=1,location =1,resizable=1,fullscreen=0');
                newwindow.focus();
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    }

    ////////////////////////////downloadFile() is not used

    downloadFile(id: number, callback: (data: any) => void) {
        const self = this;
        let data: any = {};
        $.ajax({
            url: this.submittedFilesDetailsUrl + "/" + id + "/downloadUrl",
            type: "GET",
            beforeSend(xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error(jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success(result, text, jqXhr) {
                const uri = jqXhr.getResponseHeader("Location");
                window.location.href = self.submittedFilesDetailsUrl + "/" + uri;
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    }

    ///////////////////////////////////////////////////////////////////////////////////

    private deleteFileFromStage(file: IFileExt) {
        var self = this;
        var callback = file.cancelUploadFileProgress;
        var data: any = {};
        var defs = [];
        for (let def in file.defferedUploadChunks) {
            if (file.defferedUploadChunks.hasOwnProperty(def)) {
                defs.push(file.defferedUploadChunks[def]);
            }
        }
        $.when.apply($, defs).done(() => {
            $.ajax({
                url: this.fileApiUrl + "/" + file.uri,
                type: "DELETE",
                beforeSend(xhr) {
                    xhr.setRequestHeader("Authorization", self.securityToken);
                },
                error(jqXhr, textStatus, errorThrown) {
                    data.status = ProcessStatus.Error;
                    data.message = "ERROR CANCEL UPLOAD FILE";
                    data.details = jqXhr.responseText;
                    data.statusCode = jqXhr.status;
                    data.statusText = jqXhr.statusText;
                    callback(data);
                },
                success(result, textStatus, jqXhr) {
                    data.statusCode = jqXhr.status;
                    data.status = ProcessStatus.Success;
                    data.progress = 0;
                    data.progressBytes = 0;
                    data.message = "CANCEL UPLOAD FILE";
                    callback(data);
                }
            });

        });
    }

    ////////////////////////////

    private uploadFile(file: IFileExt, uploadFileProgress: (progressData: FileProgressData) => void) {
        var self = this;
        var progressData = new FileProgressData();
        file.defferedUploadChunks = {};
        self.setFileStatus(file, FileStatus.Uploading);

        var numberOfChunks;
        if (file.size === 0) numberOfChunks = 1;
        else numberOfChunks = Math.ceil(file.size / this.settings.sizeChunk);
        var start = this.settings.sizeChunk;
        var end = start + this.settings.sizeChunk;
        var numberOfSuccessfulUploadedChunks = 0;

        createFileResource(createFileResourceProgress);

        function createFileResource(callback: (data: FileProgressData) => void) {
            var chunk = file.slice(0, self.settings.sizeChunk);
            file.defferedUploadChunks[1] = $.Deferred();
            var fileProgressData = new FileProgressData();

            $.ajax({
                url: self.fileApiUrl,
                type: "POST",
                contentType: "application/octet-stream",
                processData: false,
                data: chunk,
                beforeSend(xhr) {
                    xhr.setRequestHeader("Authorization", self.securityToken);
                    xhr.setRequestHeader("Content-Range", "bytes " + 0 + "-" + (chunk.size - 1) + "/" + file.size);
                    xhr.setRequestHeader("Content-Disposition", 'attachment; filename="' + file.name + '"');
                },
                error(jqXhr) {
                    file.defferedUploadChunks[1].resolve().promise();
                    fileProgressData.statusCode = jqXhr.status;
                    fileProgressData.statusText = jqXhr.statusText;
                    fileProgressData.processStatus = ProcessStatus.Error;
                    fileProgressData.message = "File is not uploaded";
                    fileProgressData.details = jqXhr.responseText;
                    uploadFileProgress(fileProgressData);
                },
                success(result, textStatus, jqXhr) {
                    file.defferedUploadChunks[1].resolve().promise();
                    fileProgressData.statusCode = jqXhr.status;
                    fileProgressData.processStatus = ProcessStatus.Success;
                    fileProgressData.message = "File is created";
                    fileProgressData.details = jqXhr.responseText;
                    fileProgressData.currentUploadedChunkSize = chunk.size;
                    fileProgressData.fileUri = result.PublicId;
                    callback(fileProgressData);
                }
            });
        };

        function createFileResourceProgress(data: FileProgressData) {            
            numberOfSuccessfulUploadedChunks++;
            file.uri = data.fileUri;
            progressData.fileUri = file.uri;
            progressData.statusCode = data.statusCode;
            progressData.details = data.details;
            progressData.currentUploadedChunkSize = data.currentUploadedChunkSize;
            if (self.listsOfFiles[file.listOfFilesId].isCanceled) return;
            if (numberOfChunks === 1) {
                self.setFileStatus(file, FileStatus.Uploaded);
                progressData.processStatus = ProcessStatus.Success;
                progressData.message = "File is uploaded";
                uploadFileProgress(progressData);
                return;
            }
            self.setFileStatus(file, FileStatus.Uploading);
            progressData.processStatus = ProcessStatus.InProgress;
            progressData.message = "File is uploading";
            uploadFileProgress(progressData);

            for (let i = 2; i <= self.settings.numberOfConnection + 1; i++) {
                if (start >= file.size) return;
                file.defferedUploadChunks[i] = $.Deferred();
                sendChunk(start, end, i);
                start = i * self.settings.sizeChunk;
                end = start + self.settings.sizeChunk;
            }
        };

        function sendChunk(start: number, end: number, chunkNumber: number) {
            if (self.listsOfFiles[file.listOfFilesId].isCanceled) return;
            var chunk = file.slice(start, end);
            $.ajax({
                url: self.fileApiUrl + "/" + file.uri,
                data: chunk,
                contentType: "application/octet-stream",
                processData: false,
                type: "PUT",
                beforeSend(xhr) {
                    xhr.setRequestHeader("Authorization", self.securityToken);
                    xhr.setRequestHeader("Content-Range", "bytes " + start + "-" + (start + chunk.size - 1) + "/" + file.size);
                    xhr.setRequestHeader("Content-Disposition", 'attachment; filename="' + file.name + '"');
                },
                error(jqXhr) {
                    file.defferedUploadChunks[chunkNumber].resolve().promise();
                    self.setFileStatus(file, FileStatus.UploadError);
                    progressData.processStatus = ProcessStatus.Error;
                    progressData.message = "File is not uploaded";
                    progressData.details = jqXhr.responseText;
                    progressData.statusCode = jqXhr.status;
                    progressData.statusText = jqXhr.statusText;
                    uploadFileProgress(progressData);
                },
                success(result, textStatus, jqXhr) {
                    file.defferedUploadChunks[chunkNumber].resolve().promise();
                    progressData.currentUploadedChunkSize = chunk.size;
                    uploadHandler(jqXhr, chunkNumber);
                }
            });
        };

        function uploadHandler(jqXhr: JQueryXHR, chunkNumber: number) {
            if (self.listsOfFiles[file.listOfFilesId].isCanceled) return;
            numberOfSuccessfulUploadedChunks++;
            if (numberOfSuccessfulUploadedChunks === numberOfChunks) {
                self.setFileStatus(file, FileStatus.Uploaded);
                progressData.message = "File is uploaded";
                progressData.processStatus = ProcessStatus.Success;
                uploadFileProgress(progressData);
                return;
            }
            progressData.processStatus = ProcessStatus.InProgress;
            progressData.message = "File is uploading";
            uploadFileProgress(progressData);

            chunkNumber += self.settings.numberOfConnection;

            if (chunkNumber > numberOfChunks) return;

            start = (chunkNumber - 1) * self.settings.sizeChunk;
            end = start + self.settings.sizeChunk;
            file.defferedUploadChunks[chunkNumber] = $.Deferred();
            sendChunk(start, end, chunkNumber);
        }
    }

    ////////////////////////////

    private getGuid() {
        function s4() {
            return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
        }

        return (s4() + s4() + "-" + s4() + "-4" + s4().substr(0, 3) +
            "-" + s4() + "-" + s4() + s4() + s4()).toLowerCase();
    }

    ////////////////////////////

    private setFileStatus(file: IFileExt, status: FileStatus) {

        file.status = status;

        switch (status) {
            case FileStatus.Ready:
                file.isAttached = false;
                break;
            case FileStatus.Uploading:
                break;
            case FileStatus.Uploaded:
                break;
            case FileStatus.UploadError:
                break;
            case FileStatus.Canceling:
                break;
            case FileStatus.Canceled:
                break;
            case FileStatus.CancelError:
                break;
            default:
                break;
        }
    }

    ////////////////////////////isDicom() is not used

    private isDicom(file: IFileExt): JQueryPromise<boolean> {
        var deferred = $.Deferred();
        var chunk = file.slice(128, 132);
        var reader = new FileReader();
        reader.onload = () => {
            var blob = reader.result;
            var byteArray = new Uint8Array(blob);
            var result = "";
            var byte;
            for (var i = 0; i < 4; i++) {
                byte = byteArray[i];
                if (byte === 0) {
                    break;
                }
                result += String.fromCharCode(byte);
            }
            if (result !== "DICM") {
                deferred.resolve(false);
            } else {
                deferred.resolve(true);
            }
        }
        reader.readAsArrayBuffer(chunk);
        return deferred.promise();
    }

    private arrayOfNameValueToDictionary(data) {
        var result = {};
        for (let i = 0; i < data.length; i++) {
            result[data[i].Name] = data[i].Value;
        }
        return result;
    }

}

////////////////////////////////////////////////////////////////////////////////////

class SubmissionProgressData {
    submissionPackage: SubmissionPackage;
    processStatus: ProcessStatus;
    processStep: ProcessStep;
    statusCode: number;
    statusText: string;
    message: string;
    details: string;
    progress: number;
    progressBytes: number;
    rejectedAndCorruptedData: any;
    additionalData: any; 
}

class FileProgressData {
    fileUri: string;
    currentUploadedChunkSize: number;
    processStatus: ProcessStatus;
    statusCode: number;
    statusText: string;
    message: string;
    details: string;
}

class ReviewProgressData {
    processStatus: ProcessStatus;
    processStep: ReviewProcessStep;
    statusCode: number;
    statusText: string;
    message: string;
    details: string;
    data: any;
}

class ListOfFilesForUpload {
    submissionPackageId: string;
    deferredCreatingSubmissionPackage: any;
    files: IFileExt[];
    size: number;
    isCanceled: boolean;
    defferedSubmits: { [id: string]: any };
}

class PackageOfFilesForUpload {
    id: string;
    files: IFileExt[];
    numberOfUploadedFiles: number;
    numberOfFiles: number;
    packageSize: number;
    urisOfUploadedFiles: string[];
}

class InitialSubmissionPackageResource {
    DicomsDisabled: boolean;
    NonDicomsDisabled: boolean;
    Metadata: ItemData[];
}

class SubmissionPackage {
    Id: string;
    CreationTime: Date;
    LastUpdateTime: Date;
    Status: string;
    Metadata: ItemData[];
}

enum SubmissionPackageStatus {
    Submitting,
    Complete,
    Failed
}

class ItemData {
    Name: string;
    Value: any;
}

interface IServiceSettings {
    serverApiUrl?: string;
    numberOfFilesInPackage?: number;
    sizeChunk?: number;
    numberOfConnection?: number;
    dicomsDisabled: boolean;
    nonDicomsDisabled: boolean;
}

interface IFileExt extends File {
    id: string;
    listOfFilesId: string;
    uri: string;
    status: FileStatus;
    isAttached: boolean;
    defferedUploadChunks: { [number: string]: any };
    cancelUploadFileProgress: (data: any) => void;
}

enum FileStatus {
    Ready,
    Uploading,
    Uploaded,
    UploadError,
    Canceling,
    Canceled,
    CancelError
}

enum ProcessStatus {
    InProgress,
    Success,
    Error
}

enum ProcessStep {
    Uploading,
    Processing,
    Canceling
}

enum ReviewProcessStep {
    GettingStudies,
    GettingNonDicomFiles,
    DeletingStudies,
    DeletingSeries,
    DeletingNonDicomFiles
}

enum SubmissionTransactionStatus {
    NotStarted,
    InProgress,
    InvaliidArgumentForUpload,
    FolderNotAccessibleDuringUpload,
    FileSaveErrorDuringUpload,
    IncompleteAfterLongTimeSinceUpload,
    DicomParseErrorDuringProcessing,
    DatabaseErrorDuringProcessing,
    MsmqInsertErrorDuringProcessing,
    MsmqRetrieveErrorDuringProcessing,
    UserCancelledSubmission,
    None,
    Success,
}