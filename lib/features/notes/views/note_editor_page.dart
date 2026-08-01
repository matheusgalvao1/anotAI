import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../controllers/note_editor_controller.dart';
import '../data/notes_repository.dart';
import '../models/note.dart';
import '../widgets/ai_prompt_composer.dart';
import '../widgets/markdown_editing_controller.dart';

class NoteEditorPage extends StatefulWidget {
  const NoteEditorPage({
    required this.note,
    required this.repository,
    super.key,
  });

  final Note note;
  final NotesRepository repository;

  @override
  State<NoteEditorPage> createState() => _NoteEditorPageState();
}

class _NoteEditorPageState extends State<NoteEditorPage> {
  late final NoteEditorController _controller;
  late final MarkdownEditingController _textController;
  final _noteFocus = FocusNode(debugLabel: 'note editor');
  final _promptFocus = FocusNode(debugLabel: 'AI prompt');
  final _noteScroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _controller = NoteEditorController(
      note: widget.note,
      repository: widget.repository,
    );
    _textController = MarkdownEditingController(
      text: widget.note.body,
      palette: const MarkdownPalette(
        text: Colors.black,
        muted: Colors.grey,
        accent: Color(0xFFF97316),
        codeBackground: Color(0xFFF1F1F1),
      ),
    );

    if (widget.note.body.isEmpty) {
      WidgetsBinding.instance
          .addPostFrameCallback((_) => _noteFocus.requestFocus());
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _textController.updatePalette(MarkdownPalette.of(context));
  }

  @override
  void dispose() {
    _noteFocus.dispose();
    _promptFocus.dispose();
    _noteScroll.dispose();
    _textController.dispose();
    _controller.dispose();
    super.dispose();
  }

  void _openPrompt() {
    _noteFocus
      ..canRequestFocus = false
      ..unfocus();
    _controller.openPrompt();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _promptFocus.requestFocus();
    });
  }

  void _closePrompt() {
    _promptFocus.unfocus();
    _noteFocus.canRequestFocus = true;
    _controller.closePrompt();
  }

  Future<void> _goBack() async {
    await _controller.flush();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final keyboardVisible = MediaQuery.viewInsetsOf(context).bottom > 0;

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) unawaited(_controller.flush());
      },
      child: Scaffold(
        resizeToAvoidBottomInset: true,
        appBar: AppBar(
          leadingWidth: 104,
          leading: TextButton.icon(
            onPressed: _goBack,
            icon: const Icon(CupertinoIcons.chevron_back, size: 20),
            label: const Text('Notes'),
          ),
          actions: [
            if (keyboardVisible)
              IconButton(
                tooltip: 'Hide keyboard',
                onPressed: () => FocusManager.instance.primaryFocus?.unfocus(),
                icon: const Icon(Icons.keyboard_hide_rounded),
              ),
            const SizedBox(width: 8),
          ],
        ),
        body: SafeArea(
          top: false,
          child: AnimatedBuilder(
            animation: _controller,
            builder: (context, _) => Stack(
              children: [
                Positioned.fill(
                  child: TextField(
                    key: const Key('note-editor'),
                    controller: _textController,
                    focusNode: _noteFocus,
                    scrollController: _noteScroll,
                    onChanged: _controller.updateBody,
                    readOnly: _controller.promptOpen,
                    showCursor: !_controller.promptOpen,
                    enableInteractiveSelection: !_controller.promptOpen,
                    expands: true,
                    minLines: null,
                    maxLines: null,
                    keyboardType: TextInputType.multiline,
                    textCapitalization: TextCapitalization.sentences,
                    textAlignVertical: TextAlignVertical.top,
                    style: TextStyle(
                      color: colors.onSurface,
                      fontSize: 17,
                      height: 1.43,
                      letterSpacing: -0.1,
                    ),
                    cursorColor: colors.primary,
                    cursorWidth: 2,
                    scrollPadding: const EdgeInsets.only(bottom: 150),
                    decoration: InputDecoration(
                      hintText: 'Start writing…',
                      hintStyle: TextStyle(color: colors.outline),
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding:
                          const EdgeInsets.fromLTRB(22, 18, 22, 150),
                    ),
                  ),
                ),
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 14,
                  child: AiPromptComposer(
                    open: _controller.promptOpen,
                    focusNode: _promptFocus,
                    status: _controller.promptStatus,
                    onOpen: _openPrompt,
                    onClose: _closePrompt,
                    onSubmit: _controller.submitPrompt,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
