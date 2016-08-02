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
            numberOfFilesInPackage: 4,
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
                this.setFileStatus(this.fileList[i], FileStatus.Ready);
            }
        }
    }

    ////////////////////////////

    uploadFile(file: IFileExt, uploadFileProgress: ICallbackProgress) {
        var self = this;
        var data: IDataProcess = {};

        data.file = file;
        self.setFileStatus(file, FileStatus.Uploading);

        if (!this.isContains(this.fileList, file)) {

            data.status = ProcessStatus.Error;
            data.message = "File not found. Add the file for upload";
            data.blockSize = 0;
            data.progress = 0;
            data.progressBytes = 0;

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
                    data.status = ProcessStatus.Error;
                    data.message = "File is not uploaded";
                    data.details = jqXhr.responseText;
                    uploadFileProgress(data);
                },
                success(result, textStatus, jqXhr) {
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
                self.setFileStatus(file, FileStatus.Uploaded);
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
                    self.setFileStatus(file, FileStatus.UploadError);
                    data.status = ProcessStatus.Error;
                    data.message = "File is not uploaded";
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
                self.setFileStatus(file, FileStatus.Uploaded);
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

            if (chunkNumber > numberOfChunks) return;

            start = (chunkNumber - 1) * self.settings.sizeChunk;
            end = start + self.settings.sizeChunk;
            sendChunk(start, end, chunkNumber);
        }

        function addRequest() {
            if (file.status !== FileStatus.Canceling) return true;
            if (pendingRequests === 0) {
                file.cancelUploadFileProgress = uploadFileProgress;
                self.deleteFileFromStage(file);
            }
            return false;
        }
    }

    ////////////////////////////

    cancelUploadFile(uri: string, cancelUploadFileProgress: ICallbackProgress) {
        for (let i = 0; i < this.fileList.length; i++) {
            if (this.fileList[i].uri === uri) {
                this.fileList[i].cancelUploadFileProgress = cancelUploadFileProgress;
                this.setFileStatus(this.fileList[i], FileStatus.Canceling);
                return;
            }
        }
    }

    ////////////////////////////

    uploadAndSubmitAllFiles(metadata: ItemData[], uploadAndSubmitFilesProgress: ICallbackProgress) {
        var self = this;
        var data: IDataProcess = {};
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
        var additionalSubmitTransactionUid;
        var transactionUid = self.getGuid();

        data.transactionUid = transactionUid;
        metadata.push(new ItemData("TransactionUID", transactionUid));

        var typeSubmit = TypeSubmit.CreateSubmissionPackage;

        for (let i = 0; i < metadata.length; i++) {
            if (metadata[i].Name === "TypeSubmit") {
                typeSubmit = metadata[i].Value;
                break;
            }
        }
        if (typeSubmit === TypeSubmit.AddDicomFilesToExistingSubmissionPackage) {
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
            begin = end;
            end += self.settings.numberOfFilesInPackage;
            let files = self.fileList.slice(begin, end);
            if (files.length === 0) return;
            packageOfFiles = files;           
        }


        function uploadFilesProgress(uploadData: IDataProcess) {
            //data.uploadFileData = uploadData;
            switch (uploadData.status) {
                case ProcessStatus.Success:
                    if (self.canceledTransactionUid === transactionUid) {
                        //result.file.status = "canceling";
                        //result.file.cancelUploadFileProgress = uploadAndSubmitFilesProgress;
                        //self.deleteFileFromStage(result.file);
                        return;
                    }
                    numberOfUploadedBytes += uploadData.blockSize;

                    data.status = ProcessStatus.InProgress;
                    data.message = "InProgress";
                    data.progress = Math.ceil(numberOfUploadedBytes / fileListSize * 100);
                    data.progressBytes = numberOfUploadedBytes;

                    packageOfFileUris.push(uploadData.fileUri);
                    numberOfUploadedFileInPackage++;
                    if (numberOfUploadedFileInPackage === numberOfFileInPackage) {
                        const parameters = {
                            FileUris: packageOfFileUris,
                            Metadata: metadata
                        }

                        switch (typeSubmit) {
                            case TypeSubmit.CreateSubmissionPackage:
                                self.createSubmissionPackage(parameters, submitFilesProgress);
                                break;
                            case TypeSubmit.AddDicomFilesToExistingSubmissionPackage:
                                self.addDicomFilesToExistingSubmissionPackage(additionalSubmitTransactionUid, parameters, submitFilesProgress);
                                break;
                            case TypeSubmit.AddNonDicomFilesToExistingSubmissionPackage:
                                self.addNonDicomFilesToExistingSubmissionPackage(parameters, submitFilesProgress);
                                break;
                            default:
                        }
                        return;
                    }
                    uploadAndSubmitFilesProgress(data);
                    uploadNextFileFromPackage();
                    break;
                case ProcessStatus.InProgress:
                    numberOfUploadedBytes += uploadData.blockSize;

                    data.status = ProcessStatus.InProgress;
                    data.message = "InProgress";
                    data.progress = Math.ceil(numberOfUploadedBytes / fileListSize * 100);
                    data.progressBytes = numberOfUploadedBytes;

                    uploadAndSubmitFilesProgress(data);
                    break;

                case ProcessStatus.Error:
                    data.status = ProcessStatus.Error;
                    data.message = "Error";
                    uploadAndSubmitFilesProgress(data);
                    break;

                default:
            }
        }

        function submitFilesProgress(submitData: IDataProcess) {
            //data.submitFilesData = submitData;
            switch (submitData.status) {
                case ProcessStatus.Success:
                    if (end < numberOfFiles) {
                        data.status = ProcessStatus.InProgress;
                        data.message = "InProgress";
                        uploadAndSubmitFilesProgress(data);
                        processingNextPackage();
                        return;
                    }

                    data.test = numberOfUploadedBytes + "///" + fileListSize;
                    data.status = ProcessStatus.Success;
                    data.message = "Success";
                    uploadAndSubmitFilesProgress(data);

                    break;
                case ProcessStatus.Error:

                    data.status = ProcessStatus.Error;
                    data.message = "Error";
                    //if (data.errorCode === 410) {

                    //    data.details = result.details;
                    //    for (let i = 0; i < numberOfFiles; i++) {
                    //        self.cancelUploadFile(self.fileList[i].uri, uploadAndSubmitFilesProgress);
                    //    }
                    //}
                    uploadAndSubmitFilesProgress(data);
                    break;
                default:
            }
        }
    };

    ////////////////////////////

    addDicomFilesToExistingSubmissionPackage(uri: string, parameters: SubmissionPackageData, additionalSubmitFilesProgress: ICallbackProgress) {
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

        var data: IDataProcess = {};

        $.ajax({
            url: this.submissionFileInfoApiUrl + "/" + uri,
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            error(jqXhr) {
                data.status = ProcessStatus.Error;
                data.message = "Error additionalSubmit";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                additionalSubmitFilesProgress(data);
            },
            success() {
                data.status = ProcessStatus.Success;
                data.message = "Success additionalSubmit";
                additionalSubmitFilesProgress(data);
            }
        });
    }

    ////////////////////////////

    createSubmissionPackage(parameters: SubmissionPackageData, submitFilesProgress: ICallbackProgress) {
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

        var data: IDataProcess = {};

        $.ajax({
            url: this.submissionFileInfoApiUrl,
            type: "PUT",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            error(jqXhr) {
                data.status = ProcessStatus.Error;
                data.message = "Error Submit";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                submitFilesProgress(data);
            },
            success() {
                data.status = ProcessStatus.Success;
                data.message = "Success Submit";
                submitFilesProgress(data);
            }
        });
    }

    ////////////////////////////

    addNonDicomFilesToExistingSubmissionPackage(parameters: SubmissionPackageData, submitFilesProgress: ICallbackProgress) {
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

        var data: IDataProcess = {};

        $.ajax({
            url: this.submissionFileInfoApiUrl,
            type: "POST",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
            error(jqXhr) {
                data.status = ProcessStatus.Error;
                data.message = "Error attachFiles";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                submitFilesProgress(data);
            },
            success() {
                data.status = ProcessStatus.Success;
                data.message = "Success attachFiles";
                submitFilesProgress(data);
            }
        });
    }

    ////////////////////////////

    cancelSubmit(parameters: ItemData[], cancelSubmitProgress: ICallbackProgress) {
        const self = this;
        const arr: Object = {};
        var data: IDataProcess = {};

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
                data.status = ProcessStatus.Error;
                data.message = "Error cancelSubmit";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                cancelSubmitProgress(data);
            },
            success(result, textStatus, jqXhr) {
                data.status = ProcessStatus.Success;
                data.message = "Success cancelSubmit";
                cancelSubmitProgress(data);
            },
            complete() {
                for (let i = 0; i < self.fileList.length; i++) {
                    if (self.fileList[i].status === FileStatus.Uploading) {
                        self.fileList[i].status = FileStatus.Canceling;
                    } else if (self.fileList[i].status === FileStatus.Uploaded) {
                        self.fileList[i].status = FileStatus.Canceling;
                        self.fileList[i].cancelUploadFileProgress = cancelSubmitProgress;
                        self.deleteFileFromStage(self.fileList[i]);
                    }
                }
            }
        });
    }

    ////////////////////////////

    getStudiesDetails(parameters: ItemData[], callback: (data: any) => void) {
        $.ajax({
            url: this.submittedStudiesDetailsUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: "json",
            error(jqXhr, textStatus, errorThrown) {
                let data: IDataProcess = {};
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success(data, textStatus, jqXhr) {
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    }

    ////////////////////////////

    getFileListByStudyId(studyId: number, callback: (data: any) => void) {
        const parameters = {};
        if (studyId !== undefined) {
            parameters["DicomDataStudyID"] = studyId;
        }
        parameters["ParentLevel"] = "Study";
        $.ajax({
            url: this.submittedFilesDetailsUrl + "?" + $.param(parameters),
            type: "GET",
            dataType: 'json',
            error(jqXhr, textStatus, errorThrown) {
                let data: IDataProcess = {};
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success(data, textStatus, jqXhr) {
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    }

    ////////////////////////////

    openViewer(parameters: ItemData[], callback: (data: any) => void) {
        let data: IDataProcess = {};
        $.ajax({
            url: this.dicomViewerUrl,
            type: "PUT",
            contentType: "application/json; charset=utf-8",
            data: JSON.stringify(parameters),
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

    ////////////////////////////

    downloadFile(id: number, callback: (data: any) => void) {
        const self = this;
        let data: IDataProcess = {};
        $.ajax({
            url: this.submittedFilesDetailsUrl + "/" + id + "/downloadUrl",
            type: "GET",
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

    deleteFile(id: number, callback: (data: any) => void) {
        let data: IDataProcess = {};
        $.ajax({
            url: this.submittedFilesDetailsUrl + "/" + id,
            type: "DELETE",
            error(jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = jqXhr.responseText;
                callback(data);
            },
            success(result, text, jqXhr) {
                data.status = ProcessStatus.Success;
                callback(data);
            }
        });
    }


    ////////////////////////////
    ////////////////////////////
    ////////////////////////////

    private deleteFileFromStage(file: IFileExt) {
        var callback = file.cancelUploadFileProgress;

        var data: IDataProcess = {};

        $.ajax({
            url: this.fileApiUrl + "/" + file.uri,
            type: "DELETE",
            error(jqXhr, textStatus, errorThrown) {
                data.status = ProcessStatus.Error;
                data.message = "ERROR CANCEL UPLOAD FILE";
                data.details = jqXhr.responseText;
                data.errorCode = jqXhr.status;
                callback(data);
            },
            success(result, textStatus, jqXhr) {
                data.status = ProcessStatus.Success;
                data.message = "CANCEL UPLOAD FILE";
                callback(data);
            }
        });
    }

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

    private setFileStatus(file: IFileExt, status: FileStatus) {

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
    }
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

interface IDataProcess {
    file?: IFileExt;
    message?: string;
    status?: ProcessStatus;
    fileUri?: string;
    details?: string;
    progress?: number;
    progressBytes?: number;
    blockSize?: number;
    errorCode?: number;
    transactionUid?: string;
    uploadFileData?: any;
    submitFilesData?: any;
    test?: string;
}

interface IFileExt extends File {
    number: number;
    id: string;
    uri: string;
    status: FileStatus;
    cancelUploadFileProgress: ICallbackProgress;
}

interface IServiceSettings {
    serverApiUrl?: string;
    numberOfFilesInPackage?: number;
    sizeChunk?: number;
    numberOfConnection?: number;
}

interface ICallbackProgress {
    (data: IDataProcess): void;
}

enum TypeSubmit {
    CreateSubmissionPackage,
    AddDicomFilesToExistingSubmissionPackage,
    AddNonDicomFilesToExistingSubmissionPackage
}

enum ProcessStatus {
    InProgress,
    Success,
    Error
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