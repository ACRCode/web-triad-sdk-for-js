var WebTriadService = (function () {
    //////////////////////////////////////////////////////////////////////////
    function WebTriadService(serviceSettings) {
        this.self = this;
        this.fileApiUrl = "/files";
        this.dicomViewerUrl = "/dicomViewerUrl";
        this.anonymizationProfileUrl = "/anonymizationProfile";
        this.submissionFileInfoApiUrl = "/submissionPackages";
        this.submittedSeriesDetailsUrl = "/series";
        this.submittedStudiesDetailsUrl = "/studies";
        this.submittedFilesDetailsUrl = "/submittedPackageFiles";
        this.securityToken = null;
        this.settings = $.extend({
            serverApiUrl: "http://cuv-triad-app.restonuat.local/api",
            numberOfFilesInPackage: 4,
            sizeChunk: 1024 * 1024 * 2,
            numberOfConnection: 6
        }, serviceSettings);
        var serverApiUrl = this.settings.serverApiUrl;
        this.fileApiUrl = serverApiUrl + this.fileApiUrl;
        this.submissionFileInfoApiUrl = serverApiUrl + this.submissionFileInfoApiUrl;
        this.submittedStudiesDetailsUrl = serverApiUrl + this.submittedStudiesDetailsUrl;
        this.submittedSeriesDetailsUrl = serverApiUrl + this.submittedSeriesDetailsUrl;
        this.submittedFilesDetailsUrl = serverApiUrl + this.submittedFilesDetailsUrl;
        this.dicomViewerUrl = serverApiUrl + this.dicomViewerUrl;
        this.anonymizationProfileUrl = serverApiUrl + this.anonymizationProfileUrl;
        this.listsOfFiles = {};
    }
    ////////////////////////////////////////////
    WebTriadService.prototype.submitFiles = function (files, metadata, uploadAndSubmitListOfFilesProgress) {
        var id = this.addListOfFilesForUpload(files);
        this.listsOfFiles[id].isDicom = true;
        var data = {
            listOfFilesId: id
        };
        uploadAndSubmitListOfFilesProgress(data);
        this.uploadAndSubmitListOfFiles(id, metadata, uploadAndSubmitListOfFilesProgress);
        return id;
    };
    ////////////////////////////////////////////
    WebTriadService.prototype.addListOfFilesForUpload = function (files) {
        var listOfFilesId = this.getGuid();
        this.listsOfFiles[listOfFilesId] = {
            submissionPackage: null,
            files: [],
            size: 0,
            isCanceled: false,
            submits: [],
            isDicom: false
        };
        if (files.length > 0) {
            var sizeOfFiles = 0;
            for (var i = 0; i < files.length; i++) {
                files[i].number = i;
                files[i].listOfFilesId = listOfFilesId;
                this.setFileStatus(files[i], FileStatus.Ready);
                this.listsOfFiles[listOfFilesId].files.push(files[i]);
                sizeOfFiles += files[i].size;
            }
            this.listsOfFiles[listOfFilesId].size = sizeOfFiles;
        }
        return listOfFilesId;
    };
    ////////////////////////////////////////////
    WebTriadService.prototype.uploadAndSubmitListOfFiles = function (listOfFilesId, metadata, uploadAndSubmitListOfFilesProgress) {
        var self = this;
        var listOfFiles = self.listsOfFiles[listOfFilesId];
        var startFileNumberInPackage = 0;
        var finishFileNumberInPackage = 0;
        var numberOfUploadedBytes = 0;
        var submissionPackage = new SubmissionPackage();
        var data = {};
        data.listOfFilesId = listOfFilesId;
        var currentPackage = new PackageOfFilesForUpload();
        var initialSubmissionPackageResource = {
            Metadata: metadata
        };
        self.createSubmissionPackage(initialSubmissionPackageResource, createSubmissionPackageProgress);
        function createSubmissionPackageProgress(submitData) {
            if (submitData.status === ProcessStatus.Error) {
                uploadAndSubmitListOfFilesProgress(submitData);
                return;
            }
            listOfFiles.submissionPackage = submitData.submissionPackage;
            submissionPackage = submitData.submissionPackage;
            processingNextPackage();
        }
        function processingNextPackage() {
            currentPackage.files = getNextFilesForPackage();
            if (currentPackage.files.length === 0)
                return;
            currentPackage.numberOfFiles = currentPackage.files.length;
            currentPackage.numberOfUploadedFiles = 0;
            currentPackage.packageSize = self.getSizeOfListFiles(currentPackage.files);
            currentPackage.urisOfUploadedFiles = [];
            uploadNextFileFromPackage();
        }
        function uploadNextFileFromPackage() {
            if (listOfFiles.isCanceled)
                return;
            var file = currentPackage.files.splice(0, 1)[0];
            self.uploadFile(file, uploadFileProgress);
        }
        function getNextFilesForPackage() {
            startFileNumberInPackage = finishFileNumberInPackage;
            finishFileNumberInPackage += self.settings.numberOfFilesInPackage;
            return listOfFiles.files.slice(startFileNumberInPackage, finishFileNumberInPackage);
        }
        function uploadFileProgress(uploadData) {
            switch (uploadData.status) {
                case ProcessStatus.Success:
                    if (listOfFiles.isCanceled) {
                        data.status = ProcessStatus.Success;
                        data.message = "CancelSubmit";
                        data.progress = 0;
                        data.progressBytes = 0;
                        uploadAndSubmitListOfFilesProgress(data);
                        return;
                    }
                    numberOfUploadedBytes += uploadData.blockSize;
                    data.status = ProcessStatus.InProgress;
                    data.message = "InProgress";
                    data.progress = Math.ceil(numberOfUploadedBytes / listOfFiles.size * 100);
                    data.progressBytes = numberOfUploadedBytes;
                    currentPackage.urisOfUploadedFiles.push(uploadData.fileUri);
                    currentPackage.numberOfUploadedFiles++;
                    if (currentPackage.numberOfUploadedFiles === currentPackage.numberOfFiles) {
                        var parameters = currentPackage.urisOfUploadedFiles;
                        listOfFiles.submits.push($.Deferred());
                        self.addDicomFilesToExistingSubmissionPackage(submissionPackage.Id, parameters, submitFilesProgress);
                        return;
                    }
                    uploadAndSubmitListOfFilesProgress(data);
                    uploadNextFileFromPackage();
                    break;
                case ProcessStatus.InProgress:
                    numberOfUploadedBytes += uploadData.blockSize;
                    data.status = ProcessStatus.InProgress;
                    data.message = "InProgress";
                    data.progress = Math.ceil(numberOfUploadedBytes / listOfFiles.size * 100);
                    data.progressBytes = numberOfUploadedBytes;
                    uploadAndSubmitListOfFilesProgress(data);
                    break;
                case ProcessStatus.Error:
                    data.status = ProcessStatus.Error;
                    data.message = "Error";
                    uploadAndSubmitListOfFilesProgress(data);
                    break;
                default:
            }
        }
        function submitFilesProgress(submitData) {
            var def = listOfFiles.submits.pop().resolve().promise();
            listOfFiles.submits.push(def);
            data.statusCode = submitData.statusCode;
            switch (submitData.status) {
                case ProcessStatus.Success:
                    data.skippedFiles = submitData.skippedFiles;
                    if (finishFileNumberInPackage < listOfFiles.files.length) {
                        data.status = ProcessStatus.InProgress;
                        data.message = "InProgress";
                        uploadAndSubmitListOfFilesProgress(data);
                        delete data.skippedFiles;
                        processingNextPackage();
                        return;
                    }
                    self.submitSubmissionPackage(submissionPackage.Id);
                    //self.deleteTransaction(transactionUid); need to send the request for submitting
                    data.test = numberOfUploadedBytes + "///" + listOfFiles.size;
                    data.status = ProcessStatus.Success;
                    data.message = "Success";
                    uploadAndSubmitListOfFilesProgress(data);
                    delete data.skippedFiles;
                    break;
                case ProcessStatus.Error:
                    data.status = ProcessStatus.Error;
                    data.message = "Error";
                    uploadAndSubmitListOfFilesProgress(data);
                    break;
                default:
            }
        }
    };
    ////////////////////////////
    WebTriadService.prototype.createSubmissionPackage = function (parameters, submitFilesProgress) {
        var self = this;
        var data = {};
        $.ajax({
            url: this.submissionFileInfoApiUrl,
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr) {
                data.status = ProcessStatus.Error;
                data.message = "Error Submit Create SubmitPackage";
                data.details = jqXhr.responseText;
                data.statusCode = jqXhr.status;
                submitFilesProgress(data);
            },
            success: function (result, textStatus, jqXhr) {
                data.statusCode = jqXhr.status;
                data.status = ProcessStatus.Success;
                data.message = "Success Create SubmitPackage";
                data.submissionPackage = result;
                submitFilesProgress(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.addDicomFilesToExistingSubmissionPackage = function (uri, parameters, additionalSubmitFilesProgress) {
        var self = this;
        var data = {};
        var filesUris = [];
        for (var _i = 0, parameters_1 = parameters; _i < parameters_1.length; _i++) {
            var uri_1 = parameters_1[_i];
            filesUris.push({ Id: uri_1 });
        }
        $.ajax({
            url: this.submissionFileInfoApiUrl + "/" + uri + "/files",
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(filesUris),
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr) {
                data.status = ProcessStatus.Error;
                data.message = "Error additionalSubmit";
                data.details = jqXhr.responseText;
                data.statusCode = jqXhr.status;
                additionalSubmitFilesProgress(data);
            },
            success: function (result, textStatus, jqXhr) {
                data.skippedFiles = result;
                data.statusCode = jqXhr.status;
                data.status = ProcessStatus.Success;
                data.message = "Success additionalSubmit";
                additionalSubmitFilesProgress(data);
            }
        });
    };
    //////////////////////////// It doesn't work
    WebTriadService.prototype.addNonDicomFilesToExistingSubmissionPackage = function (parameters, submitFilesProgress) {
        var self = this;
        var isContainsTransactionUid = false;
        for (var i = 0; i < parameters.Metadata.length; i++) {
            if (parameters.Metadata[i].Name === "TransactionUID") {
                isContainsTransactionUid = true;
                break;
            }
        }
        if (!isContainsTransactionUid) {
            parameters.Metadata.push({
                Name: "TransactionUID",
                Value: this.getGuid()
            });
        }
        var data = {};
        $.ajax({
            url: this.submissionFileInfoApiUrl,
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr) {
                data.status = ProcessStatus.Error;
                data.message = "Error attachFiles";
                data.details = jqXhr.responseText;
                data.statusCode = jqXhr.status;
                submitFilesProgress(data);
            },
            success: function (result, textStatus, jqXhr) {
                data.statusCode = jqXhr.status;
                data.status = ProcessStatus.Success;
                data.message = "Success attachFiles";
                submitFilesProgress(data);
            }
        });
    };
    //////////////////////////////
    WebTriadService.prototype.cancelUploadAndSubmitListOfFiles = function (listOfFilesId, cancelSubmitProgress) {
        var _this = this;
        var self = this;
        var listOfFiles = self.listsOfFiles[listOfFilesId];
        var data = {};
        data.listOfFilesId = listOfFilesId;
        listOfFiles.isCanceled = true;
        $.when.apply($, listOfFiles.submits).done(function () {
            for (var i = 0; i < listOfFiles.files.length; i++) {
                if (listOfFiles.files[i].status === FileStatus.Uploaded) {
                    listOfFiles.files[i].status = FileStatus.Canceling;
                    listOfFiles.files[i].cancelUploadFileProgress = cancelSubmitProgress;
                    _this.deleteFileFromStage(listOfFiles.files[i]);
                }
            }
            //check!!
            //$.when(listOfFiles.receiptTransactionUid).done(() => {
            $.ajax({
                url: _this.submissionFileInfoApiUrl + "/" + listOfFiles.submissionPackage.Id,
                type: "DELETE",
                beforeSend: function (xhr) {
                    xhr.setRequestHeader("Authorization", self.securityToken);
                },
                error: function (jqXhr, textStatus, errorThrown) {
                    data.status = ProcessStatus.Error;
                    data.message = "Error cancelSubmit";
                    data.details = jqXhr.responseText;
                    data.statusCode = jqXhr.status;
                    cancelSubmitProgress(data);
                },
                success: function (result, textStatus, jqXhr) {
                    data.statusCode = jqXhr.status;
                    data.status = ProcessStatus.Success;
                    data.message = "Success cancelSubmit";
                    cancelSubmitProgress(data);
                }
                //});
            });
        });
    };
    /////////////////////////////////////////
    WebTriadService.prototype.getStudiesDetails = function (parameters, callback) {
        var self = this;
        parameters = this.arrayOfNameValueToDictionary(parameters);
        $.ajax({
            url: this.submittedStudiesDetailsUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: "json",
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                var data = {};
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success: function (data, textStatus, jqXhr) {
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.deleteStudy = function (studyId, callback) {
        var self = this;
        var data = {};
        $.ajax({
            url: this.submittedStudiesDetailsUrl + "/" + studyId,
            type: "DELETE",
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success: function (result, textStatus, jqXhr) {
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.getSeriesDetails = function (parameters, callback) {
        var self = this;
        parameters = this.arrayOfNameValueToDictionary(parameters);
        $.ajax({
            url: this.submittedSeriesDetailsUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: "json",
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                var data = {};
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success: function (data, textStatus, jqXhr) {
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    };
    ///////////////////////////
    WebTriadService.prototype.deleteSeries = function (seriesId, callback) {
        var self = this;
        var data = {};
        $.ajax({
            url: this.submittedSeriesDetailsUrl + "/" + seriesId,
            type: "DELETE",
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success: function (result, textStatus, jqXhr) {
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.getFileListByStudyId = function (studyId, callback) {
        var self = this;
        var parameters = {};
        if (studyId !== undefined) {
            parameters["DicomDataStudyID"] = studyId;
        }
        parameters["ParentLevel"] = "Study";
        $.ajax({
            url: this.submittedFilesDetailsUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: 'json',
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                var data = {};
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success: function (data, textStatus, jqXhr) {
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.openViewer = function (parameters, callback) {
        var self = this;
        var data = {};
        $.ajax({
            url: this.dicomViewerUrl,
            type: "PUT",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success: function (result, textStatus, jqXhr) {
                var url = jqXhr.getResponseHeader("Location");
                var newwindow = window.open(url, 'temp window to test Claron integration', 'left=(screen.width/2)-400,top=(screen.height/2) - 180,width=800,height=360,toolbar=1,location =1,resizable=1,fullscreen=0');
                newwindow.focus();
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.downloadFile = function (id, callback) {
        var self = this;
        var data = {};
        $.ajax({
            url: this.submittedFilesDetailsUrl + "/" + id + "/downloadUrl",
            type: "GET",
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success: function (result, text, jqXhr) {
                var uri = jqXhr.getResponseHeader("Location");
                window.location.href = self.submittedFilesDetailsUrl + "/" + uri;
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    };
    /////////////////////////////
    WebTriadService.prototype.deleteFile = function (id, callback) {
        var self = this;
        var data = {};
        $.ajax({
            url: this.submittedFilesDetailsUrl + "/" + id,
            type: "DELETE",
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success: function (result, text, jqXhr) {
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.submitSubmissionPackage = function (uri) {
        var self = this;
        var data = {};
        $.ajax({
            url: this.submissionFileInfoApiUrl + "/" + uri + "/submit",
            type: "POST",
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                //callback(data);
            },
            success: function (result, text, jqXhr) {
                data.status = ProcessStatus.Success;
                //callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.deleteTransaction = function (uri) {
        var self = this;
        var data = {};
        $.ajax({
            url: this.submissionFileInfoApiUrl + "/transaction/" + uri,
            type: "DELETE",
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                //callback(data);
            },
            success: function (result, text, jqXhr) {
                data.status = ProcessStatus.Success;
                //callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.getAnonymizationProfile = function (parameters, callback) {
        var self = this;
        parameters = this.arrayOfNameValueToDictionary(parameters);
        $.ajax({
            url: this.anonymizationProfileUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: 'json',
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                var data = {};
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success: function (result, textStatus, jqXhr) {
                var data = {
                    message: result,
                    status: ProcessStatus.Success
                };
                callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.setSecurityToken = function (token) {
        this.securityToken = token;
    };
    ///////////////////////////////////////////////////////////////////////////////////
    WebTriadService.prototype.deleteFileFromStage = function (file) {
        var self = this;
        var callback = file.cancelUploadFileProgress;
        var data = {};
        data.listOfFilesId = file.listOfFilesId;
        $.ajax({
            url: this.fileApiUrl + "/" + file.uri,
            type: "DELETE",
            beforeSend: function (xhr) {
                xhr.setRequestHeader("Authorization", self.securityToken);
            },
            error: function (jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = "ERROR CANCEL UPLOAD FILE";
                data.details = jqXhr.responseText;
                data.statusCode = jqXhr.status;
                callback(data);
            },
            success: function (result, textStatus, jqXhr) {
                data.statusCode = jqXhr.status;
                data.status = ProcessStatus.Success;
                data.progress = 0;
                data.progressBytes = 0;
                data.message = "CANCEL UPLOAD FILE";
                callback(data);
            }
        });
    };
    ////////////////////////////
    WebTriadService.prototype.uploadFile = function (file, uploadFileProgress) {
        var self = this;
        var data = {};
        data.file = file;
        self.setFileStatus(file, FileStatus.Uploading);
        var numberOfChunks = Math.ceil(file.size / this.settings.sizeChunk);
        var start = this.settings.sizeChunk;
        var end = start + this.settings.sizeChunk;
        var numberOfSuccessfulUploadedChunks = 0;
        var numberOfUploadedBytes = 0;
        var pendingRequests = 0;
        var fileUri;
        createFileResource(createFileResourceProgress);
        function createFileResource(callback) {
            var chunk = file.slice(0, self.settings.sizeChunk);
            var formData = new FormData();
            formData.append("chunk", chunk, file.name);
            $.ajax({
                url: self.fileApiUrl,
                type: "PUT",
                contentType: false,
                processData: false,
                data: formData,
                beforeSend: function (xhr) {
                    xhr.setRequestHeader("Authorization", self.securityToken);
                },
                error: function (jqXhr) {
                    data.status = ProcessStatus.Error;
                    data.message = "File is not uploaded";
                    data.details = jqXhr.responseText;
                    uploadFileProgress(data);
                },
                success: function (result, textStatus, jqXhr) {
                    data.blockSize = chunk.size;
                    numberOfUploadedBytes += chunk.size;
                    callback(jqXhr);
                }
            });
        }
        ;
        function createFileResourceProgress(jqXhr) {
            numberOfSuccessfulUploadedChunks++;
            fileUri = jqXhr.getResponseHeader("Location");
            file.uri = fileUri;
            data.fileUri = fileUri;
            if (numberOfChunks === 1) {
                self.setFileStatus(file, FileStatus.Uploaded);
                if (self.listsOfFiles[file.listOfFilesId].isCanceled) {
                    file.cancelUploadFileProgress = uploadFileProgress;
                    self.deleteFileFromStage(file);
                }
                data.status = ProcessStatus.Success;
                data.message = "File is uploaded";
                data.progress = 100;
                data.progressBytes = numberOfUploadedBytes;
                uploadFileProgress(data);
                return;
            }
            self.setFileStatus(file, FileStatus.Uploading);
            data.status = ProcessStatus.InProgress;
            data.message = "File is uploading";
            data.progress = Math.ceil(numberOfUploadedBytes / file.size * 100);
            data.progressBytes = numberOfUploadedBytes;
            uploadFileProgress(data);
            for (var i = 2; i <= self.settings.numberOfConnection + 1; i++) {
                if (start >= file.size)
                    return;
                sendChunk(start, end, i);
                start = i * self.settings.sizeChunk;
                end = start + self.settings.sizeChunk;
            }
        }
        ;
        function sendChunk(start, end, chunkNumber) {
            if (!addRequest()) {
                return;
            }
            pendingRequests++;
            var chunk = file.slice(start, end);
            var formData = new FormData();
            formData.append("chunkOffset", start);
            formData.append("chunk", chunk, file.name);
            $.ajax({
                url: self.fileApiUrl + "/" + fileUri,
                data: formData,
                contentType: false,
                processData: false,
                type: "POST",
                beforeSend: function (xhr) {
                    xhr.setRequestHeader("Authorization", self.securityToken);
                },
                error: function (jqXhr) {
                    pendingRequests--;
                    self.setFileStatus(file, FileStatus.UploadError);
                    data.status = ProcessStatus.Error;
                    data.message = "File is not uploaded";
                    data.details = jqXhr.responseText;
                    uploadFileProgress(data);
                },
                success: function (result, textStatus, jqXhr) {
                    pendingRequests--;
                    data.blockSize = chunk.size;
                    numberOfUploadedBytes += chunk.size;
                    uploadHandler(jqXhr, chunkNumber);
                }
            });
        }
        ;
        function uploadHandler(jqXhr, chunkNumber) {
            numberOfSuccessfulUploadedChunks++;
            if (numberOfSuccessfulUploadedChunks === numberOfChunks) {
                self.setFileStatus(file, FileStatus.Uploaded);
                if (self.listsOfFiles[file.listOfFilesId].isCanceled) {
                    file.cancelUploadFileProgress = uploadFileProgress;
                    self.deleteFileFromStage(file);
                }
                data.message = "File is uploaded";
                data.status = ProcessStatus.Success;
                data.progress = 100;
                data.progressBytes = numberOfUploadedBytes;
                uploadFileProgress(data);
                return;
            }
            data.status = ProcessStatus.InProgress;
            data.message = "File is uploading";
            data.progress = Math.ceil(numberOfUploadedBytes / file.size * 100);
            data.progressBytes = numberOfUploadedBytes;
            uploadFileProgress(data);
            chunkNumber += self.settings.numberOfConnection;
            if (chunkNumber > numberOfChunks)
                return;
            start = (chunkNumber - 1) * self.settings.sizeChunk;
            end = start + self.settings.sizeChunk;
            sendChunk(start, end, chunkNumber);
        }
        function addRequest() {
            if (!self.listsOfFiles[file.listOfFilesId].isCanceled)
                return true;
            if (pendingRequests === 0) {
                file.cancelUploadFileProgress = uploadFileProgress;
                console.log("addRequest delete");
                self.deleteFileFromStage(file);
            }
            return false;
        }
    };
    ////////////////////////////
    WebTriadService.prototype.getGuid = function () {
        function s4() {
            return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
        }
        return (s4() + s4() + "-" + s4() + "-4" + s4().substr(0, 3) +
            "-" + s4() + "-" + s4() + s4() + s4()).toLowerCase();
    };
    ////////////////////////////
    WebTriadService.prototype.setFileStatus = function (file, status) {
        file.status = status;
        switch (status) {
            case FileStatus.Ready:
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
    };
    ////////////////////////////
    WebTriadService.prototype.getSizeOfListFiles = function (list) {
        var size = 0;
        for (var i = 0; i < list.length; i++) {
            size += list[i].size;
        }
        return size;
    };
    ////////////////////////////
    WebTriadService.prototype.isDicom = function (file) {
        var deferred = $.Deferred();
        var chunk = file.slice(128, 132);
        var reader = new FileReader();
        reader.onload = function () {
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
            }
            else {
                deferred.resolve(true);
            }
        };
        reader.readAsArrayBuffer(chunk);
        return deferred.promise();
    };
    WebTriadService.prototype.arrayOfNameValueToDictionary = function (data) {
        var result = {};
        for (var i = 0; i < data.length; i++) {
            result[data[i].Name] = data[i].Value;
        }
        return result;
    };
    return WebTriadService;
}());
////////////////////////////////////////////////////////////////////////////////////
var ListOfFilesForUpload = (function () {
    function ListOfFilesForUpload() {
    }
    return ListOfFilesForUpload;
}());
var PackageOfFilesForUpload = (function () {
    function PackageOfFilesForUpload() {
    }
    return PackageOfFilesForUpload;
}());
var InitialSubmissionPackageResource = (function () {
    function InitialSubmissionPackageResource() {
    }
    return InitialSubmissionPackageResource;
}());
var SubmissionPackage = (function () {
    function SubmissionPackage() {
    }
    return SubmissionPackage;
}());
var SubmissionPackageStatus;
(function (SubmissionPackageStatus) {
    SubmissionPackageStatus[SubmissionPackageStatus["Pending"] = 0] = "Pending";
})(SubmissionPackageStatus || (SubmissionPackageStatus = {}));
var SubmissionPackageData = (function () {
    function SubmissionPackageData(fileUris, metadata) {
        this.FileUris = fileUris;
        this.Metadata = metadata;
    }
    return SubmissionPackageData;
}());
var ItemData = (function () {
    function ItemData(name, value) {
        this.Name = name;
        this.Value = value;
    }
    return ItemData;
}());
var FileStatus;
(function (FileStatus) {
    FileStatus[FileStatus["Ready"] = 0] = "Ready";
    FileStatus[FileStatus["Uploading"] = 1] = "Uploading";
    FileStatus[FileStatus["Uploaded"] = 2] = "Uploaded";
    FileStatus[FileStatus["UploadError"] = 3] = "UploadError";
    FileStatus[FileStatus["Canceling"] = 4] = "Canceling";
    FileStatus[FileStatus["Canceled"] = 5] = "Canceled";
    FileStatus[FileStatus["CancelError"] = 6] = "CancelError";
})(FileStatus || (FileStatus = {}));
var ProcessStatus;
(function (ProcessStatus) {
    ProcessStatus[ProcessStatus["InProgress"] = 0] = "InProgress";
    ProcessStatus[ProcessStatus["Success"] = 1] = "Success";
    ProcessStatus[ProcessStatus["Error"] = 2] = "Error";
})(ProcessStatus || (ProcessStatus = {}));
//# sourceMappingURL=webTriadService.js.map