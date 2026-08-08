import 'dart:async';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../controllers/note_editor_controller.dart';
import '../widgets/ai_prompt_composer.dart';
import '../widgets/markdown_editing_controller.dart';

class NoteEditorPage extends StatefulWidget {
  const NoteEditorPage({
    required this.controller,
    super.key,
  });

  final NoteEditorController controller;

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
    _controller = widget.controller;
    _textController = MarkdownEditingController(
      text: _controller.note.body,
      palette: const MarkdownPalette(
        text: Colors.black,
        muted: Colors.grey,
        accent: Color(0xFFF97316),
        codeBackground: Color(0xFFF1F1F1),
      ),
    );
    // Agent-written bodies replace the visible text (which the user isn't
    // editing while the prompt is open) and let the markdown spans recompute.
    _controller.onBodyReplaced = _replaceEditorBody;

    if (_controller.note.body.isEmpty) {
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
    _controller.closePrompt();
    // Re-enable note focus for later taps, but do not resume editing —
    // otherwise focus leaves the prompt and the note keyboard pops open.
    _noteFocus.canRequestFocus = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _noteFocus.unfocus();
      FocusManager.instance.primaryFocus?.unfocus();
    });
  }

  Future<void> _goBack() async {
    await _controller.flush();
    if (mounted) Navigator.of(context).pop();
  }

  void _onDone() {
    if (_controller.promptOpen) {
      _closePrompt();
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
  }

  void _replaceEditorBody(String body) {
    if (_textController.text == body) return;
    _textController.text = body;
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) unawaited(_controller.flush());
      },
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final keyboardVisible = MediaQuery.viewInsetsOf(context).bottom > 0;
          final showDone = keyboardVisible || _controller.promptOpen;
          final bottomSafe = MediaQuery.paddingOf(context).bottom;
          // Clear the open prompt row. Status can overlay the note.
          const promptRowHeight = 56.0;
          const promptBottomGap = 14.0;
          final bottomInset = _controller.promptOpen
              ? promptBottomGap + promptRowHeight + bottomSafe
              : 18.0;

          return Scaffold(
            resizeToAvoidBottomInset: true,
            appBar: AppBar(
              leadingWidth: 104,
              leading: TextButton.icon(
                onPressed: _goBack,
                icon: const Icon(CupertinoIcons.chevron_back, size: 20),
                label: const Text('Notes'),
              ),
              actions: [
                if (showDone)
                  Padding(
                    padding: const EdgeInsets.only(right: 12),
                    child: Tooltip(
                      message: 'Done',
                      child: Material(
                        key: const Key('editor-done-button'),
                        color: colors.primary,
                        shape: const CircleBorder(),
                        clipBehavior: Clip.antiAlias,
                        child: InkWell(
                          onTap: _onDone,
                          customBorder: const CircleBorder(),
                          child: SizedBox.square(
                            dimension: 32,
                            child: Icon(
                              CupertinoIcons.checkmark,
                              size: 17,
                              color: colors.onPrimary,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            // Note content paints edge-to-edge (including under the home
            // indicator). Only the floating composer is inset for safe area —
            // no opaque dock behind it.
            body: Stack(
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
                    scrollPadding: EdgeInsets.only(bottom: bottomInset),
                    decoration: InputDecoration(
                      hintText: 'Start writing…',
                      hintStyle: TextStyle(color: colors.outline),
                      // Defeat the global filled InputDecorationTheme so the
                      // editor stays visually continuous with the scaffold.
                      filled: true,
                      fillColor: Colors.transparent,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding:
                          EdgeInsets.fromLTRB(22, 18, 22, bottomInset),
                    ),
                  ),
                ),
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 14 + bottomSafe,
                  child: AiPromptComposer(
                    open: _controller.promptOpen,
                    busy: _controller.promptBusy,
                    focusNode: _promptFocus,
                    status: _controller.promptStatus,
                    onOpen: _openPrompt,
                    onSubmit: _controller.submitPrompt,
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
