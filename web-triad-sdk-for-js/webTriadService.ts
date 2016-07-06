class WebTriadService {

    private fileApiUrl = "/files";
    private submissionFileInfoApiUrl = "/submissionPackages";
    private submittedStudiesDetailsUrl = "/studies";
    private submittedFilesDetailsUrl = "/submittedPackageFiles";
    private dicomViewerUrl = "/dicomViewerUrl";
    private self = this;

    private settings: IServiceSettings;
    private fileList: IFileExt[];
    private numberOfFiles: number;
    private canceledTransactionUid: string;

    constructor(serviceSettings: IServiceSettings) {

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

    addFilesForUpload(files: IFileExt[]): void {
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

    uploadFile(file: IFileExt, uploadFileProgress: ICallbackProgress) {
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
        var fileUri: string;

        createFileResource(createFileResourceProgress);

        function createFileResource(callback: (jqXhr: JQueryXHR) => void) {
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
        };

        function createFileResourceProgress(jqXhr: JQueryXHR) {
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
                if (start >= file.size) return;
                sendChunk(start, end, i);
                start = i * self.settings.sizeChunk;
                end = start + self.settings.sizeChunk;
            }

        };

        function sendChunk(start: number, end: number, chunkNumber: number) {
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
        };

        function uploadHandler(jqXhr: JQueryXHR, chunkNumber: number) {
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

            if (chunkNumber > numberOfChunks) return;

            start = (chunkNumber - 1) * self.settings.sizeChunk;
            end = start + self.settings.sizeChunk;
            sendChunk(start, end, chunkNumber);
        }

        function addRequest() {
            if (file.status !== "canceling") return true;
            if (pendingRequests === 0) {
                file.cancelUploadFileProgress = uploadFileProgress;
                self.deleteFile(file);
            }
            return false;
        }
    }


    ////////////////////////////TODO

    cancelUploadFile(uri: string, cancelUploadFileProgress: ICallbackProgress) {
        for (let i = 0; i < this.fileList.length; i++) {
            if (this.fileList[i].uri === uri) {
                this.fileList[i].cancelUploadFileProgress = cancelUploadFileProgress;
                this.setFileStatus(this.fileList[i], "canceling");
                return;
            }
        }
    }

    ////////////////////////////


    uploadAndSubmitAllFiles(metadata: ItemData[], uploadAndSubmitFilesProgress: ICallbackProgress) {
        var self = this;
        var data = new DataUploadFile();
        var numberOfUploadedFileInPackage = 0;
        var begin = 0;
        var end = 0;
        var numberOfFiles = this.fileList.length;
        var numberOfFileInPackage = 0;
        var packageOfFiles: IFileExt[] = [];
        var packageOfFileUris: string[] = [];
        var fileListSize = getSizeOfListFiles(this.fileList);
        var packageSize: number;
        var numberOfUploadedBytes = 0;
        var isAdditionalSubmit = false;
        var additionalSubmitTransactionUid;
        var transactionUid = self.getGuid();
        data.transactionUid = transactionUid;
        metadata.push(new ItemData("TransactionUID", transactionUid));

        for (let i = 0; i < metadata.length; i++) {
            if (metadata[i].Name === "AdditionalSubmitTransactionUID") {
                isAdditionalSubmit = true;
                additionalSubmitTransactionUid = metadata[i].Value;
                break;
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
            if (self.canceledTransactionUid === transactionUid) return;
            if (packageOfFiles.length === 0) return;
            const file = packageOfFiles.splice(0, 1)[0];
            self.uploadFile(file, uploadFilesProgress);
        }

        function getSizeOfListFiles(list: IFileExt[]) {
            let size = 0;
            for (let i = 0; i < list.length; i++) {
                size += list[i].size;
            }
            return size;
        }

        function getNextPackageOfFiles() {
            let currentSize = 0;
            let file: IFileExt;
            begin = end;
            end += 1;
            file = self.fileList.slice(begin, end)[0];
            packageOfFiles.push(file);
            currentSize += file.size;

            while (true) {
                file = self.fileList.slice(end, end + 1)[0];
                if (!(file && ((currentSize += file.size) < self.settings.recommendedSizePackageOfFiles))) return;
                packageOfFiles.push(file);
                begin = end;
                end += 1;
            }
        }

        function uploadFilesProgress(result: DataUploadFile) {
            switch (result.status) {
                case "uploaded":
                    if (self.canceledTransactionUid === transactionUid) {
                        //result.file.status = "canceling";
                        //result.file.cancelUploadFileProgress = uploadAndSubmitFilesProgress;
                        //self.deleteFile(result.file);
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
                        }
                        if (!isAdditionalSubmit) {
                            self.submitFiles(parameters, submitFilesProgress);
                        } else {
                            self.additionalSubmitFiles(additionalSubmitTransactionUid, parameters, submitFilesProgress);
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

        function submitFilesProgress(result: DataUploadFile) {
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
    };

    ////////////////////////////

    ////////////////////////////


    additionalSubmitFiles(uri: string, parameters: SubmissionPackageData, additionalSubmitFilesProgress: ICallbackProgress) {

        var isContainsTransactionUid = false;
        for (let i = 0; i < parameters.Metadata.length; i++) {
            if (parameters.Metadata[i].Name === "TransactionUID") {
                isContainsTransactionUid = true;
                break;
            }
        }
        if (!isContainsTransactionUid) {
            parameters.Metadata.push(
                {
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

    submitFiles(parameters: SubmissionPackageData, submitFilesProgress: ICallbackProgress) {

        let isContainsTransactionUid = false;
        for (let i = 0; i < parameters.Metadata.length; i++) {
            if (parameters.Metadata[i].Name === "TransactionUID") {
                isContainsTransactionUid = true;
                break;
            }
        }
        if (!isContainsTransactionUid) {
            parameters.Metadata.push(
                {
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

    ////////////////////////////TODO

    cancelSubmit(parameters: ItemData[], cancelSubmitProgress: ICallbackProgress) {

        const self = this;


        var data = new DataUploadFile();

        const arr: Object = {};

        for (let i = 0; i < parameters.length; i++) {
            if (parameters[i].Name === "TransactionUID") {
                this.canceledTransactionUid = parameters[i].Value;
            } else {
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
                    } else if (self.fileList[i].status === "uploaded") {
                        self.fileList[i].status = "canceling";
                        self.fileList[i].cancelUploadFileProgress = cancelSubmitProgress;
                        //fileForDelete.push(this.fileList[i]);
                        self.deleteFile(self.fileList[i]);
                    }
                }
            }
        });
        // const fileForDelete: IFileExt[] = [];


        //for (let i = 0; i < fileForDelete.length; i++) {
        //    this.deleteFile(fileForDelete[i]);
        //}
    }

    ////////////////////////////

    private isContains(list: any[], obj: any) {
        let i = list.length;
        while (i--) {
            if (list[i] === obj) {
                return true;
            }
        }
        return false;
    }

    private getGuid() {
        function s4() {
            return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
        }

        return (s4() + s4() + "-" + s4() + "-4" + s4().substr(0, 3) +
            "-" + s4() + "-" + s4() + s4() + s4()).toLowerCase();
    }

    private setFileStatus(file: IFileExt, status: string) {

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

    private deleteFile(file: IFileExt) {
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
}

class DataUploadFile {
    file: IFileExt;
    message: string;
    status: string;
    fileUri: string;
    details: string;
    progress: number;
    progressBytes: number;
    blockSize: number;
    errorCode: number;
    transactionUid: string;
    result: any;
    test: string;
}

class ItemData {
    Name: string;
    Value: any;

    constructor(name: string, value: any) {
        this.Name = name;
        this.Value = value;
    }
}

class SubmissionPackageData {
    FileUris: string[];
    Metadata: ItemData[];
    constructor(fileUris: string[], metadata: ItemData[]) {
        this.FileUris = fileUris;
        this.Metadata = metadata;
    }
}

interface IFileExt extends File {
    number: number;
    id: string;
    uri: string;
    status: string;
    cancelUploadFileProgress: (dataUploadFile: DataUploadFile) => void;
}

interface IServiceSettings {
    serverApiUrl?: string;
    recommendedSizePackageOfFiles?: number;
    sizeChunk?: number;
    numberOfConnection?: number;
}

interface ICallbackProgress {
    (data: DataUploadFile): void;
}