class WebTriadService {
    constructor(serviceSettings) {
        this.fileApiUrl = "/files";
        this.submissionFileInfoApiUrl = "/submissionPackages";
        this.submittedStudiesDetailsUrl = "/studies";
        this.submittedFilesDetailsUrl = "/submittedPackageFiles";
        this.dicomViewerUrl = "/dicomViewerUrl";
        this.self = this;
        this.settings = $.extend({
            serverApiUrl: "http://cuv-triad-app.restonuat.local/api",
            recommendedSizePackageOfFiles: 1024 * 1024 * 4,
            sizeChunk: 1024 * 1024 * 2,
            numberOfConnection: 6
        }, serviceSettings);
        const serverApiUrl = this.settings.serverApiUrl;
        this.fileApiUrl = serverApiUrl + this.fileApiUrl;
        this.submissionFileInfoApiUrl = serverApiUrl + this.submissionFileInfoApiUrl;
        this.submittedStudiesDetailsUrl = serverApiUrl + this.submittedStudiesDetailsUrl;
        this.submittedFilesDetailsUrl = serverApiUrl + this.submittedFilesDetailsUrl;
        this.dicomViewerUrl = serverApiUrl + this.dicomViewerUrl;
        this.fileList = [];
        this.numberOfFiles = 0;
    }
    addFilesForUpload(files) {
        this.fileList = [];
        this.numberOfFiles = files.length;
        if (this.numberOfFiles > 0) {
            for (let i = 0; i < this.numberOfFiles; i++) {
                files[i].number = i;
                files[i].id = files[i].name + files[i].size;
                this.fileList.push(files[i]);
                this.setFileStatus(this.fileList[i], "ready");
            }
        }
    }
    uploadFile(file, uploadFileProgress) {
        var self = this;
        self.setFileStatus(file, "uploading");
        var data = new DataUploadFile();
        data.file = file;
        if (!this.isContains(this.fileList, file)) {
            data.message = "File not found. Add the file for upload";
            data.status = "error";
            uploadFileProgress(data);
            return;
        }
        var numberOfChunks = Math.ceil(file.size / this.settings.sizeChunk);
        var start = this.settings.sizeChunk;
        var end = start + this.settings.sizeChunk;
        var numberOfSuccessfulUploadChunks = 0;
        var numberOfUploadedBytes = 0;
        var pendingRequests = 0;
        var fileUri;
        createFileResource(createFileResourceProgress);
        function createFileResource(callback) {
            //pendingRequests++;
            var chunk = file.slice(0, self.settings.sizeChunk);
            const formData = new FormData();
            formData.append("chunk", chunk, file.name);
            $.ajax({
                url: self.fileApiUrl,
                type: "PUT",
                contentType: false,
                processData: false,
                data: formData,
                error(jqXhr) {
                    //pendingRequests--;
                    data.status = "error";
                    data.message = "File is not upload";
                    data.details = jqXhr.responseText;
                    uploadFileProgress(data);
                },
                success(result, textStatus, jqXhr) {
                    //pendingRequests--;
                    data.blockSize = chunk.size;
                    numberOfUploadedBytes += chunk.size;
                    callback(jqXhr);
                }
            });
        }
        ;
        function createFileResourceProgress(jqXhr) {
            numberOfSuccessfulUploadChunks++;
            fileUri = jqXhr.getResponseHeader("Location");
            file.uri = fileUri;
            data.fileUri = fileUri;
            if (numberOfChunks === 1) {
                self.setFileStatus(file, "uploaded");
                data.message = "File is uploaded";
                data.status = "uploaded";
                data.progress = 100;
                data.progressBytes = numberOfUploadedBytes;
                uploadFileProgress(data);
                return;
            }
            data.status = "uploading";
            data.message = "File is uploading";
            data.progress = Math.ceil(numberOfUploadedBytes / file.size * 100);
            data.progressBytes = numberOfUploadedBytes;
            uploadFileProgress(data);
            for (let i = 2; i <= self.settings.numberOfConnection + 1; i++) {
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
            const formData = new FormData();
            formData.append("chunkOffset", start);
            formData.append("chunk", chunk, file.name);
            $.ajax({
                url: self.fileApiUrl + "/" + fileUri,
                data: formData,
                contentType: false,
                processData: false,
                type: "POST",
                error(jqXhr) {
                    pendingRequests--;
                    data.status = "error";
                    data.message = "File is not upload";
                    data.details = jqXhr.responseText;
                    uploadFileProgress(data);
                },
                success(result, textStatus, jqXhr) {
                    pendingRequests--;
                    data.blockSize = chunk.size;
                    numberOfUploadedBytes += chunk.size;
                    uploadHandler(jqXhr, chunkNumber);
                }
            });
        }
        ;
        function uploadHandler(jqXhr, chunkNumber) {
            numberOfSuccessfulUploadChunks++;
            if (numberOfSuccessfulUploadChunks === numberOfChunks) {
                self.setFileStatus(file, "uploaded");
                data.message = "File is uploaded";
                data.status = "uploaded";
                data.progress = 100;
                data.progressBytes = numberOfUploadedBytes;
                uploadFileProgress(data);
                return;
            }
            data.status = "uploading";
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
            if (file.status !== "canceling")
                return true;
            if (pendingRequests === 0) {
                file.cancelUploadFileProgress = uploadFileProgress;
                self.deleteFileFromStage(file);
            }
            return false;
        }
    }
    ////////////////////////////TODO
    cancelUploadFile(uri, cancelUploadFileProgress) {
        for (let i = 0; i < this.fileList.length; i++) {
            if (this.fileList[i].uri === uri) {
                this.fileList[i].cancelUploadFileProgress = cancelUploadFileProgress;
                this.setFileStatus(this.fileList[i], "canceling");
                return;
            }
        }
    }
    ////////////////////////////
    uploadAndSubmitAllFiles(metadata, uploadAndSubmitFilesProgress) {
        var self = this;
        var data = new DataUploadFile();
        var numberOfUploadedFileInPackage = 0;
        var begin = 0;
        var end = 0;
        var numberOfFiles = this.fileList.length;
        var numberOfFileInPackage = 0;
        var packageOfFiles = [];
        var packageOfFileUris = [];
        var fileListSize = getSizeOfListFiles(this.fileList);
        var packageSize;
        var numberOfUploadedBytes = 0;
        var additionalSubmitTransactionUid;
        var transactionUid = self.getGuid();
        data.transactionUid = transactionUid;
        metadata.push(new ItemData("TransactionUID", transactionUid));
        var typeSubmit = TypeSubmit.Submit;
        for (let i = 0; i < metadata.length; i++) {
            if (metadata[i].Name === "TypeSubmit") {
                typeSubmit = metadata[i].Value;
                break;
            }
        }
        if (typeSubmit === TypeSubmit.AdditionalSubmit) {
            for (let i = 0; i < metadata.length; i++) {
                if (metadata[i].Name === "AdditionalSubmitTransactionUID") {
                    additionalSubmitTransactionUid = metadata[i].Value;
                    break;
                }
            }
        }
        processingNextPackage();
        function processingNextPackage() {
            getNextPackageOfFiles();
            numberOfUploadedFileInPackage = 0;
            numberOfFileInPackage = packageOfFiles.length;
            packageSize = getSizeOfListFiles(packageOfFiles);
            packageOfFileUris = [];
            uploadNextFileFromPackage();
        }
        function uploadNextFileFromPackage() {
            if (self.canceledTransactionUid === transactionUid)
                return;
            if (packageOfFiles.length === 0)
                return;
            const file = packageOfFiles.splice(0, 1)[0];
            self.uploadFile(file, uploadFilesProgress);
        }
        function getSizeOfListFiles(list) {
            let size = 0;
            for (let i = 0; i < list.length; i++) {
                size += list[i].size;
            }
            return size;
        }
        function getNextPackageOfFiles() {
            let currentSize = 0;
            let file;
            begin = end;
            end += 1;
            file = self.fileList.slice(begin, end)[0];
            packageOfFiles.push(file);
            currentSize += file.size;
            while (true) {
                file = self.fileList.slice(end, end + 1)[0];
                if (!(file && ((currentSize += file.size) < self.settings.recommendedSizePackageOfFiles)))
                    return;
                packageOfFiles.push(file);
                begin = end;
                end += 1;
            }
        }
        function uploadFilesProgress(result) {
            switch (result.status) {
                case "uploaded":
                    if (self.canceledTransactionUid === transactionUid) {
                        //result.file.status = "canceling";
                        //result.file.cancelUploadFileProgress = uploadAndSubmitFilesProgress;
                        //self.deleteFileFromStage(result.file);
                        return;
                    }
                    numberOfUploadedBytes += result.blockSize;
                    data.progress = Math.ceil(numberOfUploadedBytes / fileListSize * 100);
                    data.progressBytes = numberOfUploadedBytes;
                    data.status = "processing";
                    data.message = "uploadFileProgress";
                    data.result = result;
                    packageOfFileUris.push(result.fileUri);
                    numberOfUploadedFileInPackage++;
                    if (numberOfUploadedFileInPackage === numberOfFileInPackage) {
                        const parameters = {
                            FileUris: packageOfFileUris,
                            Metadata: metadata
                        };
                        switch (typeSubmit) {
                            case TypeSubmit.Submit:
                                self.submitFiles(parameters, submitFilesProgress);
                                break;
                            case TypeSubmit.AdditionalSubmit:
                                self.additionalSubmitFiles(additionalSubmitTransactionUid, parameters, submitFilesProgress);
                                break;
                            case TypeSubmit.AttachFile:
                                self.attachFile(parameters, submitFilesProgress);
                                break;
                            default:
                        }
                        return;
                    }
                    uploadAndSubmitFilesProgress(data);
                    uploadNextFileFromPackage();
                    break;
                case "uploading":
                    numberOfUploadedBytes += result.blockSize;
                    data.progress = Math.ceil(numberOfUploadedBytes / fileListSize * 100);
                    data.progressBytes = numberOfUploadedBytes;
                    data.status = "processing";
                    data.message = "uploadFileProgress";
                    data.result = result;
                    uploadAndSubmitFilesProgress(data);
                    break;
                case "error":
                    data.status = "error";
                    data.message = "uploadFileProgress";
                    uploadAndSubmitFilesProgress(data);
                    break;
                default:
            }
        }
        function submitFilesProgress(result) {
            switch (result.status) {
                case "success":
                    if (end < numberOfFiles) {
                        data.status = "processing";
                        data.message = "submitFilesProgress";
                        uploadAndSubmitFilesProgress(data);
                        processingNextPackage();
                        return;
                    }
                    data.test = numberOfUploadedBytes + "///" + fileListSize;
                    data.status = "success";
                    data.message = "submitFilesProgress";
                    uploadAndSubmitFilesProgress(data);
                    break;
                case "error":
                    data.status = "error";
                    data.message = "submitFilesProgress";
                    if (data.errorCode === 410) {
                        data.details = result.details;
                        for (let i = 0; i < numberOfFiles; i++) {
                            self.cancelUploadFile(self.fileList[i].uri, uploadAndSubmitFilesProgress);
                        }
                    }
                    uploadAndSubmitFilesProgress(data);
                    break;
                default:
            }
        }
    }
    ;
    ////////////////////////////
    ////////////////////////////
    additionalSubmitFiles(uri, parameters, additionalSubmitFilesProgress) {
        var isContainsTransactionUid = false;
        for (let i = 0; i < parameters.Metadata.length; i++) {
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
        var data = new DataUploadFile();
        $.ajax({
            url: this.submissionFileInfoApiUrl + "/" + uri,
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            error(jqXhr) {
                data.status = "error";
                data.message = "ERROR additionalSubmitFiles";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                additionalSubmitFilesProgress(data);
            },
            success() {
                data.status = "success";
                data.message = "additionalSubmitFiles";
                additionalSubmitFilesProgress(data);
            }
        });
    }
    ////////////////////////////
    submitFiles(parameters, submitFilesProgress) {
        let isContainsTransactionUid = false;
        for (let i = 0; i < parameters.Metadata.length; i++) {
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
        var data = new DataUploadFile();
        $.ajax({
            url: this.submissionFileInfoApiUrl,
            type: "PUT",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            error(jqXhr) {
                data.status = "error";
                data.message = "ERROR SUBMIT";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                submitFilesProgress(data);
            },
            success() {
                data.status = "success";
                submitFilesProgress(data);
            }
        });
    }
    ////////////////////////////
    attachFile(parameters, submitFilesProgress) {
        let isContainsTransactionUid = false;
        for (let i = 0; i < parameters.Metadata.length; i++) {
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
        var data = new DataUploadFile();
        $.ajax({
            url: this.submissionFileInfoApiUrl,
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            error(jqXhr) {
                data.status = "error";
                data.message = "ERROR Attach";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                submitFilesProgress(data);
            },
            success() {
                data.status = "success";
                submitFilesProgress(data);
            }
        });
    }
    ////////////////////////////TODO
    cancelSubmit(parameters, cancelSubmitProgress) {
        const self = this;
        var data = new DataUploadFile();
        const arr = {};
        for (let i = 0; i < parameters.length; i++) {
            if (parameters[i].Name === "TransactionUID") {
                this.canceledTransactionUid = parameters[i].Value;
            }
            else {
                arr[parameters[i].Name] = parameters[i].Value;
            }
        }
        $.ajax({
            url: this.submissionFileInfoApiUrl + "/" + this.canceledTransactionUid + "?" + $.param(arr),
            type: "DELETE",
            error(jqXhr, textStatus, errorThrown) {
                data.status = "error";
                data.message = "ERROR cancelSubmit";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                cancelSubmitProgress(data);
            },
            success(result, textStatus, jqXhr) {
                data.status = "success";
                data.message = "cancelSubmit";
                cancelSubmitProgress(data);
            },
            complete() {
                for (let i = 0; i < self.fileList.length; i++) {
                    if (self.fileList[i].status === "uploading") {
                        self.fileList[i].status = "canceling";
                    }
                    else if (self.fileList[i].status === "uploaded") {
                        self.fileList[i].status = "canceling";
                        self.fileList[i].cancelUploadFileProgress = cancelSubmitProgress;
                        // const fileForDelete: IFileExt[] = [];
                        //fileForDelete.push(this.fileList[i]);
                        //for (let i = 0; i < fileForDelete.length; i++) {
                        //    this.deleteFileFromStage(fileForDelete[i]);
                        //}
                        self.deleteFileFromStage(self.fileList[i]);
                    }
                }
            }
        });
    }
    getStudiesDetails(parameters, callback) {
        $.ajax({
            url: this.submittedStudiesDetailsUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: "json",
            error(jqXhr, textStatus, errorThrown) {
                //console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
            },
            success(data, textStatus, jqXhr) {
                callback(data);
            }
        });
    }
    ////////////////////////////
    getFileListByStudyId(studyId, callback) {
        const parameters = {};
        parameters["DicomDataStudyId"] = studyId;
        parameters["ParentLevel"] = "Study";
        $.ajax({
            url: this.submittedFilesDetailsUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: 'json',
            error(jqXhr, textStatus, errorThrown) {
                console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
            },
            success(data, textStatus, jqXhr) {
                callback(data);
            }
        });
    }
    ////////////////////////////
    openViewer(parameters, callback) {
        $.ajax({
            url: this.dicomViewerUrl,
            type: "PUT",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            error(jqXhr, textStatus, errorThrown) {
                console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
            },
            success(data, textStatus, jqXhr) {
                const url = jqXhr.getResponseHeader("Location");
                callback(url);
            }
        });
    }
    ////////////////////////////
    downloadFile(id) {
        const self = this;
        $.ajax({
            url: this.submittedFilesDetailsUrl + "/getUrlFile/" + id,
            type: "GET",
            success(result, text, jqXhr) {
                const url = jqXhr.getResponseHeader("Location");
                window.location.href = self.submittedFilesDetailsUrl + "/" + url;
            }
        });
    }
    deleteFile(id, callback) {
        $.ajax({
            url: this.submittedFilesDetailsUrl + "/" + id,
            type: "DELETE",
            error(jqXhr, textStatus, errorThrown) {
                console.log(textStatus + " // " + errorThrown + " // " + jqXhr.responseText);
            },
            success() {
                callback();
            }
        });
    }
    ////////////////////////////
    ////////////////////////////
    ////////////////////////////
    deleteFileFromStage(file) {
        var callback = file.cancelUploadFileProgress;
        var data = new DataUploadFile();
        $.ajax({
            url: this.fileApiUrl + "/" + file.uri,
            type: "DELETE",
            error(jqXhr, textStatus, errorThrown) {
                data.status = "error";
                data.message = "ERROR CANCEL UPLOAD FILE";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                callback(data);
            },
            success(result, textStatus, jqXhr) {
                data.status = "success";
                data.message = "CANCEL UPLOAD FILE";
                callback(data);
            }
        });
    }
    isContains(list, obj) {
        let i = list.length;
        while (i--) {
            if (list[i] === obj) {
                return true;
            }
        }
        return false;
    }
    getGuid() {
        function s4() {
            return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
        }
        return (s4() + s4() + "-" + s4() + "-4" + s4().substr(0, 3) +
            "-" + s4() + "-" + s4() + s4() + s4()).toLowerCase();
    }
    setFileStatus(file, status) {
        file.status = status;
        switch (status) {
            case "ready":
                break;
            case "uploading":
                break;
            case "uploaded":
                break;
            case "uploadError":
                break;
            case "canceling":
                break;
            case "canceled":
                break;
            case "cancelError":
                break;
            default:
                break;
        }
    }
}
class DataUploadFile {
}
class ItemData {
    constructor(name, value) {
        this.Name = name;
        this.Value = value;
    }
}
class SubmissionPackageData {
    constructor(fileUris, metadata) {
        this.FileUris = fileUris;
        this.Metadata = metadata;
    }
}
class SubmittedStudyDetails {
    constructor(studyUri, submissionPackageUri, metadata) {
        this.StudyUri = studyUri;
        this.SubmissionPackageUri = submissionPackageUri;
        this.Metadata = metadata;
    }
}
class SubmittedFileDetails {
    constructor(fileId, metadata) {
        this.FileId = fileId;
        this.Metadata = metadata;
    }
}
var TypeSubmit;
(function (TypeSubmit) {
    TypeSubmit[TypeSubmit["Submit"] = 0] = "Submit";
    TypeSubmit[TypeSubmit["AdditionalSubmit"] = 1] = "AdditionalSubmit";
    TypeSubmit[TypeSubmit["AttachFile"] = 2] = "AttachFile";
})(TypeSubmit || (TypeSubmit = {}));
//# sourceMappingURL=webTriadService.js.map